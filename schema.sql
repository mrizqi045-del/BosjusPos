-- ==============================================================================
-- SKRIP SQL TIDB CLOUD (MYSQL COMPATIBLE) UNTUK BOSJUSPOS
-- ==============================================================================
-- Petunjuk:
-- 1. Buka console TiDB Cloud (https://tidbcloud.com)
-- 2. Pilih Cluster/Instance Anda -> Buka menu "SQL Editor"
-- 3. Salin query di bawah ini dan klik "Run"

CREATE TABLE IF NOT EXISTS bjp_data (
    `key` VARCHAR(191) NOT NULL PRIMARY KEY,
    `value` LONGTEXT NOT NULL,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabel ini menyimpan seluruh data operasional (Users, Products, Transactions,
-- Stock Opname, Mutasi Stok, Keuangan, Resep, Promo, QRIS, Printer, & Owner).
