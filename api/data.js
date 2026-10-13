// Vercel Serverless Function - BosJusPos API with TiDB Cloud (MySQL)
const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    const host = process.env.TIDB_HOST;
    const port = parseInt(process.env.TIDB_PORT || '4000', 10);
    const user = process.env.TIDB_USER;
    const password = process.env.TIDB_PASSWORD;
    const database = process.env.TIDB_DATABASE || 'test';

    if (!host || !user) {
      throw new Error('Database credentials missing: Please set TIDB_HOST, TIDB_USER, and TIDB_PASSWORD in environment variables.');
    }

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
      },
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60000,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  }
  return pool;
}

let tableChecked = false;
async function ensureTable(db) {
  if (tableChecked) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS bjp_data (
      \`key\` VARCHAR(191) NOT NULL PRIMARY KEY,
      \`value\` LONGTEXT NOT NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  tableChecked = true;
}

function parseJsonSafe(val, fallback) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
}

// Smart Union Merge Helper by ID (mencegah data offline menimpa data server)
// voidedIds: Set/Array ID yang sudah dihapus/dibatalkan - tidak boleh muncul kembali dari data server lama
function mergeArrayRecords(incomingArr, existingArr, sortKey = 'date', voidedIds = []) {
  if (!Array.isArray(incomingArr) || incomingArr.length === 0) return existingArr || [];
  if (!Array.isArray(existingArr) || existingArr.length === 0) return incomingArr || [];
  const voidSet = new Set(Array.isArray(voidedIds) ? voidedIds.map(String) : []);
  const map = new Map();
  // Masukkan data server lama - skip jika ID sudah dihapus
  for (const item of existingArr) {
    if (item && item.id && !voidSet.has(String(item.id))) map.set(item.id, item);
  }
  // Terapkan data incoming (data terbaru dari client) - incoming menang kecuali sudah divoid
  for (const item of incomingArr) {
    if (item && item.id && !voidSet.has(String(item.id))) {
      if (map.has(item.id)) {
        const existing = map.get(item.id);
        const incUp = Number(item.updatedAt) || 0;
        const exUp = Number(existing.updatedAt) || 0;
        // Jika client mengirim versi yang memiliki updatedAt lebih baru/sama (misal hasil edit tanggal/jam oleh superowner)
        if (incUp > 0 && incUp >= exUp) {
          map.set(item.id, item);
          continue;
        }
        if (exUp > incUp) {
          // Server sudah memiliki versi yang diedit lebih baru
          continue;
        }
        // Jika tidak ada updatedAt baru dan dua transaksi kebetulan nomor id sama saat offline (beda waktu > 5 detik), amankan keduanya
        if (existing.date && item.date && existing.date !== item.date && Math.abs(new Date(existing.date) - new Date(item.date)) > 5000) {
          const disambiguatedId = `${item.id}-DEV-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
          item.id = disambiguatedId;
          map.set(disambiguatedId, item);
          continue;
        }
      }
      map.set(item.id, item);
    }
  }
  const merged = Array.from(map.values());
  if (sortKey) {
    merged.sort((a, b) => new Date(b[sortKey] || 0) - new Date(a[sortKey] || 0));
  }
  return merged;
}

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const db = getPool();

    // ==========================================
    // GET: Ambil Data (getAllData / getOwnerData)
    // ==========================================
    if (req.method === 'GET') {
      // Real-time multi-device sync: no cache agar HP & PC selalu dapat data terkini
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

      const action = req.query.action || 'getData';

      if (action === 'getOwnerData') {
        const ownerKeys = [
          'ownerCapitalConfig', 'ownerCashFlow', 'ownerDebtInstallments', 'ownerOfficeTransfers',
          'bjp_owner_capital_v7', 'bjp_owner_cashflow_v7', 'bjp_owner_debts_v7', 'bjp_office_transfers_v7'
        ];
        const [rows] = await db.query(
          'SELECT `key`, `value` FROM bjp_data WHERE `key` IN (?)',
          [ownerKeys]
        );
        const data = {};
        for (const row of rows) {
          data[row.key] = row.value;
        }
        return res.status(200).json({ status: 'success', data });
      }

      // Default: getData / getDatabase
      const [rows] = await db.query('SELECT `key`, `value` FROM bjp_data');
      const data = {};
      for (const row of rows) {
        data[row.key] = row.value;
      }

      // Pastikan outlet default selalu ada
      if (!data['bjp_outlets_v7'] || data['bjp_outlets_v7'] === '[]' || data['bjp_outlets_v7'] === '') {
        data['bjp_outlets_v7'] = JSON.stringify([
          { id: 'out-xqwj31v61', name: 'Sampit', address: 'Sampit Bundaran' }
        ]);
      }

      // Normalisasi invoice dev hasil tabrakan batas lama 900000
      if (data['bjp_transactions_v7']) {
        data['bjp_transactions_v7'] = data['bjp_transactions_v7'].replace(/INV-PC-900000-DEV-[A-Za-z0-9]+/g, 'INV-PC-900001');
      }

      return res.status(200).json({ status: 'success', data });
    }

    // ==========================================
    // POST: Simpan Data (saveAllData / saveOwnerData)
    // ==========================================
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {
          body = {};
        }
      } else if (!body) {
        body = {};
      }

      const action = body.action || 'saveAllData';

      // 1. Simpan Data Owner
      if (action === 'saveOwnerData' || body.ownerCapitalConfig || body.ownerCashFlow || body.ownerDebtInstallments || body.ownerOfficeTransfers) {
        const payload = body.payload || body;
        const upsertPromises = [];

        const mapping = {
          ownerCapitalConfig: payload.ownerCapitalConfig,
          ownerCashFlow: payload.ownerCashFlow,
          ownerDebtInstallments: payload.ownerDebtInstallments,
          ownerOfficeTransfers: payload.ownerOfficeTransfers,
          bjp_owner_capital_v7: payload.ownerCapitalConfig,
          bjp_owner_cashflow_v7: payload.ownerCashFlow,
          bjp_owner_debts_v7: payload.ownerDebtInstallments,
          bjp_office_transfers_v7: payload.ownerOfficeTransfers
        };

        for (const [k, v] of Object.entries(mapping)) {
          if (v !== undefined && v !== null && v !== '') {
            const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            upsertPromises.push(
              db.query(
                'INSERT INTO bjp_data (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP',
                [k, valStr]
              )
            );
          }
        }

        await Promise.all(upsertPromises);
        return res.status(200).json({ status: 'success', message: 'Data owner berhasil disimpan' });
      }

      // 2. Simpan Seluruh Data POS (saveAllData / saveData)
      const dataObj = body.payload || body;

      // Ambil data yang ada saat ini untuk Safety Guard
      const [existingRows] = await db.query('SELECT `key`, `value` FROM bjp_data');
      const existingMap = {};
      for (const r of existingRows) {
        existingMap[r.key] = r.value;
      }

      // Safety Guard: Cegah perangkat baru / cache kosong menimpa data transaksi, produk, dsb jika DB sudah terisi
      const criticalArrayKeys = [
        'bjp_transactions_v7', 'bjp_products_v7', 'bjp_users_v7', 'bjp_outlets_v7', 'bjp_finance_v7',
        'ownerCashFlow', 'ownerOfficeTransfers', 'ownerDebtInstallments', 'ownerCapitalConfig',
        'bjp_owner_cashflow_v7', 'bjp_office_transfers_v7', 'bjp_owner_debts_v7', 'bjp_owner_capital_v7'
      ];

      for (const cKey of criticalArrayKeys) {
        if (dataObj[cKey] !== undefined) {
          const parsed = parseJsonSafe(dataObj[cKey], null);
          let isEmpty = false;
          if (Array.isArray(parsed) && parsed.length === 0) {
            isEmpty = true;
          } else if (parsed && typeof parsed === 'object' && cKey === 'bjp_finance_v7') {
            if ((!parsed.expenses || parsed.expenses.length === 0) && (!parsed.incomes || parsed.incomes.length === 0)) {
              isEmpty = true;
            }
          }

          if (isEmpty && existingMap[cKey]) {
            const existingVal = String(existingMap[cKey] || '');
            if (existingVal && existingVal !== '[]' && existingVal !== '{}' && existingVal !== '""') {
              console.warn('Safety Guard: Mencegah penimpaan data kosong pada ' + cKey + '. Data lama dipertahankan.');
              delete dataObj[cKey];
            }
          }
        }
      }

      // Smart Union Merge: Gabungkan transaksi, keuangan, log stok yang dibuat saat offline agar tidak menimpa data server
      // Ambil daftar ID yang sudah dihapus/dibatalkan dari client - untuk mencegah data lama di server muncul kembali
      const voidedTxRaw = parseJsonSafe(dataObj.bjp_voided_txs_v7 || existingMap.bjp_voided_txs_v7, []);
      const deletedRaw = parseJsonSafe(dataObj.bjp_deleted_records_v7 || existingMap.bjp_deleted_records_v7, []);
      // Gabungkan voided + deleted dari client DAN dari server supaya filter permanen
      const allVoidedIds = Array.from(new Set([
        ...(Array.isArray(voidedTxRaw) ? voidedTxRaw.map(String) : []),
        ...(Array.isArray(deletedRaw) ? deletedRaw.map(String) : [])
      ]));

      if (dataObj.bjp_transactions_v7) {
        dataObj.bjp_transactions_v7 = dataObj.bjp_transactions_v7.replace(/INV-PC-900000-DEV-[A-Za-z0-9]+/g, 'INV-PC-900001');
      }
      if (existingMap.bjp_transactions_v7) {
        existingMap.bjp_transactions_v7 = existingMap.bjp_transactions_v7.replace(/INV-PC-900000-DEV-[A-Za-z0-9]+/g, 'INV-PC-900001');
      }

      if (dataObj.bjp_transactions_v7 && existingMap.bjp_transactions_v7) {
        const inc = parseJsonSafe(dataObj.bjp_transactions_v7, []);
        const ex = parseJsonSafe(existingMap.bjp_transactions_v7, []);
        dataObj.bjp_transactions_v7 = JSON.stringify(mergeArrayRecords(inc, ex, 'date', allVoidedIds));
      }

      if (dataObj.bjp_finance_v7 && existingMap.bjp_finance_v7) {
        const incFin = parseJsonSafe(dataObj.bjp_finance_v7, {});
        const exFin = parseJsonSafe(existingMap.bjp_finance_v7, {});
        dataObj.bjp_finance_v7 = JSON.stringify({
          modalUsaha: incFin.modalUsaha !== undefined ? incFin.modalUsaha : exFin.modalUsaha,
          profitSplit: incFin.profitSplit || exFin.profitSplit,
          expenses: mergeArrayRecords(incFin.expenses || [], exFin.expenses || [], 'date', allVoidedIds),
          incomes: mergeArrayRecords(incFin.incomes || [], exFin.incomes || [], 'date', allVoidedIds)
        });
      }

      if (dataObj.bjp_transfers_v7 && existingMap.bjp_transfers_v7) {
        const inc = parseJsonSafe(dataObj.bjp_transfers_v7, []);
        const ex = parseJsonSafe(existingMap.bjp_transfers_v7, []);
        dataObj.bjp_transfers_v7 = JSON.stringify(mergeArrayRecords(inc, ex, 'date', allVoidedIds));
      }

      if (dataObj.bjp_raw_material_logs_v7 && existingMap.bjp_raw_material_logs_v7) {
        const inc = parseJsonSafe(dataObj.bjp_raw_material_logs_v7, []);
        const ex = parseJsonSafe(existingMap.bjp_raw_material_logs_v7, []);
        dataObj.bjp_raw_material_logs_v7 = JSON.stringify(mergeArrayRecords(inc, ex, 'date', allVoidedIds));
      }

      if ((dataObj.ownerOfficeTransfers || dataObj.bjp_office_transfers_v7) && (existingMap.ownerOfficeTransfers || existingMap.bjp_office_transfers_v7)) {
        const inc = parseJsonSafe(dataObj.ownerOfficeTransfers || dataObj.bjp_office_transfers_v7, []);
        const ex = parseJsonSafe(existingMap.ownerOfficeTransfers || existingMap.bjp_office_transfers_v7, []);
        const mergedOff = JSON.stringify(mergeArrayRecords(inc, ex, 'date', allVoidedIds));
        dataObj.ownerOfficeTransfers = mergedOff;
        dataObj.bjp_office_transfers_v7 = mergedOff;
      }

      // Gabungkan daftar voided/deleted dari server dan client, lalu simpan versi terbaru yang lebih lengkap
      if (allVoidedIds.length > 0) {
        dataObj.bjp_voided_txs_v7 = JSON.stringify(allVoidedIds);
        dataObj.bjp_deleted_records_v7 = JSON.stringify(allVoidedIds);
      }

      // Eksekusi Upsert
      const upsertPromises = [];
      for (const [k, v] of Object.entries(dataObj)) {
        if (k === 'action' || k === 'payload') continue;
        if (v !== undefined && v !== null) {
          const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          upsertPromises.push(
            db.query(
              'INSERT INTO bjp_data (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP',
              [k, valStr]
            )
          );
        }
      }

      await Promise.all(upsertPromises);
      return res.status(200).json({ status: 'success', message: 'Data berhasil disimpan ke TiDB Cloud' });
    }

    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  } catch (err) {
    console.error('TiDB API Error:', err);
    return res.status(500).json({ status: 'error', message: err.message || err.toString() });
  }
};
