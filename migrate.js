// Skrip Migrasi Data dari Google Apps Script Spreadsheet / File JSON ke TiDB Cloud
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

async function getTiDBConnection() {
  const host = process.env.TIDB_HOST;
  const port = parseInt(process.env.TIDB_PORT || '4000', 10);
  const user = process.env.TIDB_USER;
  const password = process.env.TIDB_PASSWORD;
  const database = process.env.TIDB_DATABASE || 'test';

  if (!host || !user || !password) {
    throw new Error('Konfigurasi TIDB belum lengkap di file .env');
  }

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    ssl: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    }
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS bjp_data (
      \`key\` VARCHAR(191) NOT NULL PRIMARY KEY,
      \`value\` LONGTEXT NOT NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  return conn;
}

async function runMigration() {
  const args = process.argv.slice(2);
  let mode = null;
  let source = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      mode = 'url';
      source = args[i + 1];
    } else if (args[i] === '--file' && args[i + 1]) {
      mode = 'file';
      source = args[i + 1];
    } else if (args[i] === '--csv' && args[i + 1]) {
      mode = 'csv';
      source = args[i + 1];
    }
  }

  if (!mode) {
    console.log('=== PANDUAN MIGRASI DATA KE TIDB CLOUD ===');
    console.log('Pilihan cara migrasi:');
    console.log('1. Dari Web App Google Apps Script:');
    console.log('   node migrate.js --url "https://script.google.com/macros/s/.../exec"\n');
    console.log('2. Dari File JSON:');
    console.log('   node migrate.js --file backup_data.json\n');
    console.log('3. Dari File CSV Spreadsheet (Sheet "Database"):');
    console.log('   node migrate.js --csv Database.csv\n');
    return;
  }

  console.log(`Memulai migrasi dari [${mode.toUpperCase()}]: ${source}...`);
  let dataToMigrate = {};

  if (mode === 'url') {
    try {
      console.log('Mengambil data dari Google Apps Script...');
      const res = await fetch(`${source}?action=getData`);
      const json = await res.json();
      if (json && json.status === 'success' && json.data) {
        dataToMigrate = json.data;
      } else {
        throw new Error('Format data dari Apps Script tidak sesuai: ' + JSON.stringify(json));
      }

      // Ambil juga data owner jika ada
      try {
        const resOwner = await fetch(`${source}?action=getOwnerData`);
        const jsonOwner = await resOwner.json();
        if (jsonOwner && jsonOwner.data) {
          Object.assign(dataToMigrate, jsonOwner.data);
        }
      } catch (e) {
        console.log('Data owner tidak ditemukan atau sudah termasuk.');
      }
    } catch (err) {
      console.error('Gagal mengambil data dari URL:', err.message);
      return;
    }
  } else if (mode === 'file') {
    try {
      const raw = fs.readFileSync(source, 'utf8');
      dataToMigrate = JSON.parse(raw);
    } catch (err) {
      console.error('Gagal membaca file JSON:', err.message);
      return;
    }
  } else if (mode === 'csv') {
    try {
      const raw = fs.readFileSync(source, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const commaIdx = line.indexOf(',');
        if (commaIdx !== -1) {
          const k = line.substring(0, commaIdx).replace(/^"|"$/g, '').trim();
          const v = line.substring(commaIdx + 1).replace(/^"|"$/g, '').trim();
          if (k && k !== 'Key') {
            dataToMigrate[k] = v;
          }
        }
      }
    } catch (err) {
      console.error('Gagal membaca file CSV:', err.message);
      return;
    }
  }

  const keys = Object.keys(dataToMigrate);
  console.log(`Ditemukan ${keys.length} keys untuk dimigrasikan.`);
  if (keys.length === 0) {
    console.log('Tidak ada data untuk dimigrasikan.');
    return;
  }

  try {
    const conn = await getTiDBConnection();
    console.log('Terhubung ke TiDB Cloud. Memasukkan data ke tabel bjp_data...');

    let inserted = 0;
    for (const k of keys) {
      const v = dataToMigrate[k];
      const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
      await conn.query(
        'INSERT INTO bjp_data (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP',
        [k, valStr]
      );
      inserted++;
      console.log(`[OK] (${inserted}/${keys.length}) Migrasi key: ${k}`);
    }

    await conn.end();
    console.log(`\n=== MIGRASI SELESAI SUKSES! ===`);
    console.log(`Total ${inserted} keys berhasil disimpan di TiDB Cloud.`);
  } catch (err) {
    console.error('Terjadi kesalahan saat migrasi ke TiDB Cloud:', err.message);
  }
}

runMigration();
