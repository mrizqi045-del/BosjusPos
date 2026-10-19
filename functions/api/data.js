function escapeSql(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/[\0\x08\x09\x1a\n\r"'\\]/g, (char) => {
    switch (char) {
      case "\0": return "\\0";
      case "\x08": return "\\b";
      case "\x09": return "\\t";
      case "\x1a": return "\\z";
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\"":
      case "'":
      case "\\":
        return "\\" + char;
      default:
        return char;
    }
  });
}

async function runQuery(sql, env) {
  const host = (env && env.TIDB_HOST) || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com';
  const user = (env && env.TIDB_USER) || 'WfFgzjTRaRoALsg.root';
  const password = (env && env.TIDB_PASSWORD) || 'yRi0mmi6ptNuctfi';
  const database = (env && env.TIDB_DATABASE) || 'test';

  const url = `https://http-${host}/v1beta/sql`;
  const auth = btoa(`${user}:${password}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
      'TiDB-Database': database
    },
    body: JSON.stringify({ query: sql })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TiDB error: ${errText}`);
  }

  const data = await res.json();
  const fields = (data.types || []).map(t => t.name);
  return (data.rows || []).map(row => {
    const obj = {};
    fields.forEach((f, idx) => { obj[f] = row[idx]; });
    return obj;
  });
}

function parseJsonSafe(val, fallback) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
}

function mergeArrayRecords(incomingArr, existingArr, sortKey = 'date', voidedIds = []) {
  if (!Array.isArray(incomingArr) || incomingArr.length === 0) return existingArr || [];
  if (!Array.isArray(existingArr) || existingArr.length === 0) return incomingArr || [];
  const voidSet = new Set(Array.isArray(voidedIds) ? voidedIds.map(String) : []);
  const map = new Map();
  for (const item of existingArr) {
    if (item && item.id && !voidSet.has(String(item.id))) map.set(item.id, item);
  }
  for (const item of incomingArr) {
    if (item && item.id && !voidSet.has(String(item.id))) {
      if (map.has(item.id)) {
        const existing = map.get(item.id);
        const incUp = Number(item.updatedAt) || 0;
        const exUp = Number(existing.updatedAt) || 0;
        if (incUp > 0 && incUp >= exUp) {
          map.set(item.id, item);
          continue;
        }
        if (exUp > incUp) {
          continue;
        }
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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const jsonResponse = (data, status = 200, extraHeaders = {}) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...extraHeaders,
      },
    });
  };

  try {
    // ==========================================
    // GET: Ambil Data (getAllData / getOwnerData)
    // ==========================================
    if (request.method === 'GET') {
      const action = url.searchParams.get('action') || 'getData';

      if (action === 'checkUpdate') {
        const since = Number(url.searchParams.get('since') || 0);
        const rows = await runQuery("SELECT `value`, UNIX_TIMESTAMP(`updated_at`) * 1000 as ts FROM bjp_data WHERE `key` = 'bjp_last_updated_v7'", env);
        let serverTime = 0;
        if (rows.length > 0) {
          serverTime = Number(rows[0].value) || Number(rows[0].ts) || 0;
        } else {
          const maxRows = await runQuery("SELECT UNIX_TIMESTAMP(MAX(`updated_at`)) * 1000 as max_ts FROM bjp_data", env);
          serverTime = maxRows.length > 0 && maxRows[0].max_ts ? Number(maxRows[0].max_ts) : 0;
        }

        return jsonResponse({
          status: 'success',
          hasUpdate: serverTime > since,
          serverTime,
          clientSince: since
        }, 200, {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
      }

      if (action === 'getOwnerData') {
        const ownerKeys = [
          'ownerCapitalConfig', 'ownerCashFlow', 'ownerDebtInstallments', 'ownerOfficeTransfers',
          'bjp_owner_capital_v7', 'bjp_owner_cashflow_v7', 'bjp_owner_debts_v7', 'bjp_office_transfers_v7'
        ];
        const quotedKeys = ownerKeys.map(k => `'${k}'`).join(',');
        const rows = await runQuery(`SELECT \`key\`, \`value\` FROM bjp_data WHERE \`key\` IN (${quotedKeys})`, env);
        const data = {};
        for (const row of rows) {
          data[row.key] = row.value;
        }
        return jsonResponse({ status: 'success', data }, 200, {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
      }

      // Default: getData / getDatabase
      const rows = await runQuery('SELECT `key`, `value` FROM bjp_data', env);
      const data = {};
      for (const row of rows) {
        data[row.key] = row.value;
      }

      if (!data['bjp_outlets_v7'] || data['bjp_outlets_v7'] === '[]' || data['bjp_outlets_v7'] === '') {
        data['bjp_outlets_v7'] = JSON.stringify([
          { id: 'out-xqwj31v61', name: 'Sampit', address: 'Sampit Bundaran' }
        ]);
      }

      return jsonResponse({ status: 'success', data }, 200, {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      });
    }

    // ==========================================
    // POST: Simpan Data (saveAllData / saveOwnerData)
    // ==========================================
    if (request.method === 'POST') {
      let body;
      try {
        const rawText = await request.text();
        body = typeof rawText === 'string' ? JSON.parse(rawText) : (rawText || {});
      } catch (e) {
        body = {};
      }

      const action = body.action || 'saveAllData';

      // 1. Simpan Data Owner
      if (action === 'saveOwnerData') {
        const payload = body.payload || body;

        if (payload.bjp_deleted_records_v7) {
          const incDel = parseJsonSafe(payload.bjp_deleted_records_v7, []);
          const curDelRows = await runQuery("SELECT `value` FROM bjp_data WHERE `key` = 'bjp_deleted_records_v7'", env);
          const curDel = curDelRows.length > 0 ? parseJsonSafe(curDelRows[0].value, []) : [];
          const mergedDel = Array.from(new Set([...curDel.map(String), ...incDel.map(String)]));
          payload.bjp_deleted_records_v7 = JSON.stringify(mergedDel);
        }

        const mapping = {
          ownerCapitalConfig: payload.ownerCapitalConfig,
          ownerCashFlow: payload.ownerCashFlow,
          ownerDebtInstallments: payload.ownerDebtInstallments,
          ownerOfficeTransfers: payload.ownerOfficeTransfers,
          bjp_owner_capital_v7: payload.ownerCapitalConfig,
          bjp_owner_cashflow_v7: payload.ownerCashFlow,
          bjp_owner_debts_v7: payload.ownerDebtInstallments,
          bjp_office_transfers_v7: payload.ownerOfficeTransfers,
          bjp_deleted_records_v7: payload.bjp_deleted_records_v7
        };

        const items = [];
        for (const [k, v] of Object.entries(mapping)) {
          if (v !== undefined && v !== null && v !== '') {
            const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            items.push([k, valStr]);
          }
        }

        if (items.length > 0) {
          const valueClauses = items.map(([k, valStr]) => `('${escapeSql(k)}', '${escapeSql(valStr)}')`).join(',');
          await runQuery(
            `INSERT INTO bjp_data (\`key\`, \`value\`) VALUES ${valueClauses} ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
            env
          );
        }

        return jsonResponse({ status: 'success', message: 'Data owner berhasil disimpan' });
      }

      // 2. Simpan Data Delta / Inkremental (saveDelta)
      if (action === 'saveDelta') {
        const changedKeys = body.changedKeys || {};
        const stockDeltas = body.stockDeltas || [];
        const newLogs = body.newLogs || [];

        // Baca semua data existing dari DB sekali saja
        const existingRows = await runQuery('SELECT `key`, `value` FROM bjp_data', env);
        const existingMap = {};
        for (const r of existingRows) {
          existingMap[r.key] = r.value;
        }

        // Merge changedKeys per-record (id + updatedAt)
        const updatedItems = {};
        for (const [key, incomingStr] of Object.entries(changedKeys)) {
          if (key === 'bjp_raw_materials_v7') continue; // stok bahan baku pakai stockDeltas
          const incoming = parseJsonSafe(incomingStr, null);
          const existing = parseJsonSafe(existingMap[key], null);

          if (key === 'bjp_finance_v7') {
            // Finance = object { modalUsaha, profitSplit, expenses, incomes }
            const incFin = incoming || {};
            const exFin = existing || {};
            updatedItems[key] = JSON.stringify({
              modalUsaha: incFin.modalUsaha !== undefined ? incFin.modalUsaha : exFin.modalUsaha,
              profitSplit: incFin.profitSplit || exFin.profitSplit,
              expenses: mergeArrayRecords(incFin.expenses || [], exFin.expenses || [], 'date', []),
              incomes: mergeArrayRecords(incFin.incomes || [], exFin.incomes || [], 'date', [])
            });
          } else if (Array.isArray(incoming)) {
            const ex = Array.isArray(existing) ? existing : [];
            updatedItems[key] = JSON.stringify(mergeArrayRecords(incoming, ex, 'date', []));
          } else if (incoming !== null && incoming !== undefined) {
            // Non-array value (string, object) - langsung overwrite
            updatedItems[key] = typeof incoming === 'object' ? JSON.stringify(incoming) : String(incomingStr);
          }
        }

        // Proses stockDeltas: baca bjp_raw_materials_v7, apply delta relatif
        if (stockDeltas.length > 0) {
          const rawMaterials = parseJsonSafe(existingMap['bjp_raw_materials_v7'], []);
          if (Array.isArray(rawMaterials)) {
            for (const sd of stockDeltas) {
              const { materialId, outletId, delta } = sd;
              if (!materialId || !outletId || typeof delta !== 'number') continue;
              const rmIdx = rawMaterials.findIndex(rm => rm && rm.id === materialId);
              if (rmIdx === -1) continue;
              const rm = { ...rawMaterials[rmIdx] };
              const stocks = { ...(rm.stocks || {}) };
              const currentVal = Number(stocks[outletId]) || 0;
              stocks[outletId] = Math.max(0, currentVal + delta);
              rm.stocks = stocks;
              // Update primary stock (first outlet key or outletId)
              const primaryKey = Object.keys(stocks)[0] || outletId;
              rm.stock = Number(stocks[primaryKey]) || 0;
              rm.updatedAt = Date.now();
              rawMaterials[rmIdx] = rm;
            }
            updatedItems['bjp_raw_materials_v7'] = JSON.stringify(rawMaterials);
          }
        }

        // Append newLogs ke existing raw_material_logs
        if (newLogs.length > 0) {
          const existingLogs = parseJsonSafe(existingMap['bjp_raw_material_logs_v7'], []);
          const logMap = new Map();
          for (const l of existingLogs) { if (l && l.id) logMap.set(l.id, l); }
          for (const l of newLogs) { if (l && l.id) logMap.set(l.id, l); }
          const merged = Array.from(logMap.values());
          merged.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
          updatedItems['bjp_raw_material_logs_v7'] = JSON.stringify(merged);
        }

        // Merge deleted records
        if (body.deletedRecordIds) {
          const incDel = Array.isArray(body.deletedRecordIds) ? body.deletedRecordIds : parseJsonSafe(body.deletedRecordIds, []);
          const curDel = parseJsonSafe(existingMap['bjp_deleted_records_v7'], []);
          const merged = Array.from(new Set([...curDel.map(String), ...incDel.map(String)]));
          updatedItems['bjp_deleted_records_v7'] = JSON.stringify(merged);
        }

        // Update timestamp
        updatedItems['bjp_last_updated_v7'] = String(Date.now());

        // Batch upsert
        const items = [];
        for (const [k, v] of Object.entries(updatedItems)) {
          if (v !== undefined && v !== null) {
            items.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
          }
        }
        if (items.length > 0) {
          const valueClauses = items.map(([k, valStr]) => `('${escapeSql(k)}', '${escapeSql(valStr)}')`).join(',');
          await runQuery(
            `INSERT INTO bjp_data (\`key\`, \`value\`) VALUES ${valueClauses} ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
            env
          );
        }

        return jsonResponse({ status: 'success', message: 'Delta sync berhasil' });
      }

      // 2b. Arsip transaksi lama (archiveOld)
      if (action === 'archiveOld') {
        const txRows = await runQuery("SELECT `value` FROM bjp_data WHERE `key` = 'bjp_transactions_v7'", env);
        if (txRows.length > 0) {
          const allTx = parseJsonSafe(txRows[0].value, []);
          if (Array.isArray(allTx) && allTx.length > 5000) {
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            const cutoff = threeMonthsAgo.toISOString();
            const recent = [];
            const old = [];
            for (const tx of allTx) {
              if (tx && tx.date && tx.date < cutoff) {
                old.push(tx);
              } else {
                recent.push(tx);
              }
            }
            if (old.length > 0) {
              // Gabungkan ke arsip existing
              const archRows = await runQuery("SELECT `value` FROM bjp_data WHERE `key` = 'bjp_transactions_archive_v7'", env);
              const existingArchive = archRows.length > 0 ? parseJsonSafe(archRows[0].value, []) : [];
              const archMap = new Map();
              for (const t of existingArchive) { if (t && t.id) archMap.set(t.id, t); }
              for (const t of old) { if (t && t.id) archMap.set(t.id, t); }
              const mergedArchive = Array.from(archMap.values());

              const items = [
                ['bjp_transactions_v7', JSON.stringify(recent)],
                ['bjp_transactions_archive_v7', JSON.stringify(mergedArchive)],
                ['bjp_last_updated_v7', String(Date.now())]
              ];
              const valueClauses = items.map(([k, v]) => `('${escapeSql(k)}', '${escapeSql(v)}')`).join(',');
              await runQuery(
                `INSERT INTO bjp_data (\`key\`, \`value\`) VALUES ${valueClauses} ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
                env
              );
              return jsonResponse({ status: 'success', message: `Arsip: ${old.length} transaksi dipindah`, archived: old.length, remaining: recent.length });
            }
          }
        }
        return jsonResponse({ status: 'success', message: 'Tidak ada transaksi yang perlu diarsipkan', archived: 0 });
      }

      // 3. Simpan Seluruh Data POS (saveAllData / saveData)
      const dataObj = body.payload || body;

      const existingRows = await runQuery('SELECT `key`, `value` FROM bjp_data', env);
      const existingMap = {};
      for (const r of existingRows) {
        existingMap[r.key] = r.value;
      }

      // Safety Guard
      const criticalArrayKeys = [
        'bjp_transactions_v7', 'bjp_products_v7', 'bjp_users_v7', 'bjp_outlets_v7', 'bjp_finance_v7',
        'bjp_raw_materials_v7', 'bjp_raw_material_logs_v7', 'bjp_transfers_v7',
        'bjp_stock_receipts_v7', 'bjp_stock_outs_v7', 'bjp_stock_opnames_v7', 'bjp_promos_v7',
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

      // Smart Union Merge
      const clientVoided = parseJsonSafe(dataObj.bjp_voided_txs_v7, []);
      const serverVoided = parseJsonSafe(existingMap.bjp_voided_txs_v7, []);
      const clientDeleted = parseJsonSafe(dataObj.bjp_deleted_records_v7, []);
      const serverDeleted = parseJsonSafe(existingMap.bjp_deleted_records_v7, []);
      const allVoidedIds = Array.from(new Set([
        ...(Array.isArray(clientVoided) ? clientVoided.map(String) : []),
        ...(Array.isArray(serverVoided) ? serverVoided.map(String) : []),
        ...(Array.isArray(clientDeleted) ? clientDeleted.map(String) : []),
        ...(Array.isArray(serverDeleted) ? serverDeleted.map(String) : [])
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

      const fixSirsakLogs = (rawStr) => {
        const rawLogs = parseJsonSafe(rawStr, []);
        if (!Array.isArray(rawLogs)) return rawStr;
        return JSON.stringify(rawLogs.map(l => {
          if (!l) return l;
          if (l.note && l.note.toLowerCase().includes('sirsak') && (String(l.refTxId).includes('900000') || String(l.source).includes('900000') || String(l.source).includes('DEV'))) {
            return { ...l, date: '2026-10-13T03:08:13.000Z', refTxId: 'INV-PC-900001', source: 'Penjualan #PC-900001', updatedAt: Date.now() };
          }
          return l;
        }));
      };
      if (dataObj.bjp_raw_material_logs_v7) dataObj.bjp_raw_material_logs_v7 = fixSirsakLogs(dataObj.bjp_raw_material_logs_v7);
      if (existingMap.bjp_raw_material_logs_v7) existingMap.bjp_raw_material_logs_v7 = fixSirsakLogs(existingMap.bjp_raw_material_logs_v7);

      if (dataObj.bjp_raw_material_logs_v7 && existingMap.bjp_raw_material_logs_v7) {
        const inc = parseJsonSafe(dataObj.bjp_raw_material_logs_v7, []);
        const ex = parseJsonSafe(existingMap.bjp_raw_material_logs_v7, []);
        dataObj.bjp_raw_material_logs_v7 = JSON.stringify(mergeArrayRecords(inc, ex, 'date', allVoidedIds));
      }

      if (dataObj.bjp_raw_materials_v7 && existingMap.bjp_raw_materials_v7) {
        const inc = parseJsonSafe(dataObj.bjp_raw_materials_v7, []);
        const ex = parseJsonSafe(existingMap.bjp_raw_materials_v7, []);
        if (Array.isArray(inc) && Array.isArray(ex)) {
          const map = new Map();
          for (const item of ex) {
            if (item && item.id && !allVoidedIds.includes(String(item.id))) {
              map.set(String(item.id), item);
            }
          }
          for (const item of inc) {
            if (item && item.id && !allVoidedIds.includes(String(item.id))) {
              const cur = map.get(String(item.id));
              if (!cur || (Number(item.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) {
                map.set(String(item.id), item);
              }
            }
          }
          dataObj.bjp_raw_materials_v7 = JSON.stringify(Array.from(map.values()));
        }
      }

      if (dataObj.ownerOfficeTransfers || dataObj.bjp_office_transfers_v7 || existingMap.ownerOfficeTransfers || existingMap.bjp_office_transfers_v7) {
        const inc = parseJsonSafe(dataObj.ownerOfficeTransfers || dataObj.bjp_office_transfers_v7, null);
        const ex = parseJsonSafe(existingMap.ownerOfficeTransfers || existingMap.bjp_office_transfers_v7, []);
        const baseOff = inc !== null ? mergeArrayRecords(inc, ex, 'date', allVoidedIds) : ex.filter(item => item && item.id && !allVoidedIds.includes(String(item.id)));
        const mergedOff = JSON.stringify(baseOff);
        dataObj.ownerOfficeTransfers = mergedOff;
        dataObj.bjp_office_transfers_v7 = mergedOff;
      }

      if (allVoidedIds.length > 0) {
        dataObj.bjp_voided_txs_v7 = JSON.stringify(allVoidedIds);
        dataObj.bjp_deleted_records_v7 = JSON.stringify(allVoidedIds);
      }

      dataObj.bjp_last_updated_v7 = String(Date.now());

      // Single Batch Upsert
      const skipFields = new Set(['action', 'payload', 'changedKeys', 'stockDeltas', 'newLogs', 'deletedRecordIds', '_forceHumanSync']);
      const items = [];
      for (const [k, v] of Object.entries(dataObj)) {
        if (skipFields.has(k)) continue;
        if (v !== undefined && v !== null) {
          const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          items.push([k, valStr]);
        }
      }

      if (items.length > 0) {
        const valueClauses = items.map(([k, valStr]) => `('${escapeSql(k)}', '${escapeSql(valStr)}')`).join(',');
        await runQuery(
          `INSERT INTO bjp_data (\`key\`, \`value\`) VALUES ${valueClauses} ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
          env
        );
      }

      return jsonResponse({ status: 'success', message: 'Data berhasil disimpan ke TiDB Cloud' });
    }

    return jsonResponse({ status: 'error', message: 'Method Not Allowed' }, 405);
  } catch (err) {
    console.error('TiDB API Error:', err);
    return jsonResponse({ status: 'error', message: err.message || err.toString() }, 500);
  }
}
