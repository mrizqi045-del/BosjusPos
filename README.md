# BosJusPos - TiDB Cloud + Vercel Deployment

Aplikasi Point of Sale (POS) & Manajemen Finansial BosJus dengan dukungan Cloud Database TiDB Serverless (MySQL Compatible) dan hosting instan di Vercel.

---

## 1. Setup Database TiDB Cloud

1. Di console TiDB Cloud (https://tidbcloud.com), klik **Create** pada cluster Starter (Free $0/month, Region Singapore).
2. Setelah cluster selesai dibuat, buka menu **Connect** atau **Security**:
   - Salin **Host** (contoh: `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`)
   - Salin **Port** (`4000`)
   - Salin **User** (contoh: `xxxxxx.root`)
   - Buat/salin **Password**
   - Nama database default: `test` (atau buat database baru misal `bosjuspos`).
3. *(Opsional)* Di menu **SQL Editor** pada TiDB Cloud, jalankan query dari file `schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS bjp_data (
       `key` VARCHAR(191) NOT NULL PRIMARY KEY,
       `value` LONGTEXT NOT NULL,
       `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
   ```
   *(Catatan: Vercel API `api/data.js` juga akan otomatis membuat tabel ini jika belum ada).*

---

## 2. Deploy ke Vercel

1. Buka dashboard Vercel (https://vercel.com).
2. Klik **Add New...** -> **Project**.
3. Import repository GitHub: **`mrizqi045-del/BosJusPos`**.
4. Di bagian **Environment Variables**, tambahkan 5 variabel berikut:
   - `TIDB_HOST` = `<host dari TiDB Cloud>`
   - `TIDB_PORT` = `4000`
   - `TIDB_USER` = `<user dari TiDB Cloud>`
   - `TIDB_PASSWORD` = `<password dari TiDB Cloud>`
   - `TIDB_DATABASE` = `test` (atau nama database yang Anda tentukan)
5. Klik **Deploy**.
6. Aplikasi POS Anda langsung aktif di domain Vercel (misal: `https://bosjuspos.vercel.app`).
   - Halaman POS: `/`
   - Halaman Owner: `/owner.html`
   - Endpoint API: `/api/data`

---

## 3. Cara Migrasi Database dari Spreadsheet ke TiDB Cloud

Pilih salah satu cara termudah berikut:

### Cara 1: Sekali Klik dari Aplikasi POS (Paling Mudah)
1. Buka aplikasi POS Anda yang sudah berjalan.
2. Buka menu **Pengaturan** (ikon gear / Cloud Sync).
3. Di bagian bawah terdapat tombol hijau: **"Unggah Seluruh Data Lokal ke TiDB Cloud"**.
4. Klik tombol tersebut. Seluruh data transaksi, menu produk, resep bahan baku, riwayat mutasi stok, dan laporan keuangan dari browser akan langsung terkirim dan tersimpan aman di TiDB Cloud.

### Cara 2: Menggunakan Skrip Migrasi CLI
1. Buat file `.env` di folder proyek ini berisi konfigurasi TiDB Cloud Anda.
2. Jalankan perintah migrasi langsung dengan URL Web App Google Apps Script Anda:
   ```bash
   node migrate.js --url "https://script.google.com/macros/s/.../exec"
   ```
   Atau jika Anda mengunduh sheet `Database` sebagai file CSV:
   ```bash
   node migrate.js --csv Database.csv
   ```
