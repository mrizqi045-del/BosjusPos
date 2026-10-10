// Skrip pengujian koneksi ke TiDB Cloud
require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
  const host = process.env.TIDB_HOST;
  const port = parseInt(process.env.TIDB_PORT || '4000', 10);
  const user = process.env.TIDB_USER;
  const password = process.env.TIDB_PASSWORD;
  const database = process.env.TIDB_DATABASE || 'test';

  console.log('--- TEST KONEKSI TIDB CLOUD ---');
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`User: ${user}`);
  console.log(`Database: ${database}`);

  if (!host || !user || !password) {
    console.error('\n[ERROR] Konfigurasi belum lengkap! Silakan isi file .env terlebih dahulu.');
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection({
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

    console.log('\n[BERHASIL] Terhubung ke TiDB Cloud!');
    const [rows] = await connection.query('SELECT VERSION() as version, DATABASE() as db');
    console.log('Versi Database:', rows[0].version);
    console.log('Nama Database:', rows[0].db);

    // Pastikan tabel bjp_data ada
    await connection.query(`
      CREATE TABLE IF NOT EXISTS bjp_data (
        \`key\` VARCHAR(191) NOT NULL PRIMARY KEY,
        \`value\` LONGTEXT NOT NULL,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [tableCount] = await connection.query('SELECT COUNT(*) as cnt FROM bjp_data');
    console.log('Tabel bjp_data siap! Jumlah baris saat ini:', tableCount[0].cnt);

    await connection.end();
    console.log('\nPengujian selesai dengan sukses!');
  } catch (err) {
    console.error('\n[GAGAL] Gagal terhubung ke TiDB Cloud:', err.message);
  }
}

testConnection();
