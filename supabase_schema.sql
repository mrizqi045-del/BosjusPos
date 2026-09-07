-- ==============================================================================
-- SKRIP SQL EDITOR SUPABASE UNTUK BOSJUSPOS
-- URL Proyek: https://inukuuqwbcfzsyurnmka.supabase.co
-- ==============================================================================
-- Petunjuk:
-- 1. Buka dashboard Supabase: https://supabase.com/dashboard/project/inukuuqwbcfzsyurnmka
-- 2. Buka menu "SQL Editor" di bilah sebelah kiri.
-- 3. Salin seluruh isi skrip ini, tempelkan ke SQL Editor, lalu klik "RUN".
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABEL UTAMA: bjp_data (SINKRONISASI REALTIME BOSJUSPOS & NETLIFY)
-- ------------------------------------------------------------------------------
-- Tabel ini digunakan oleh aplikasi web BosJusPos (React di Netlify/GitHub)
-- untuk menyimpan seluruh data operasional (pengguna, produk, transaksi,
-- inventaris, keuangan, kartu stok, resep, promo, QRIS, dan printer).
CREATE TABLE IF NOT EXISTS public.bjp_data (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Berikan komentar pada tabel
COMMENT ON TABLE public.bjp_data IS 'Penyimpanan sinkronisasi cloud real-time untuk aplikasi BosJusPos';

-- Aktifkan Row Level Security (RLS)
ALTER TABLE public.bjp_data ENABLE ROW LEVEL SECURITY;

-- Buat Kebijakan Akses (RLS Policies) untuk anon dan authenticated
DROP POLICY IF EXISTS "Allow public read bjp_data" ON public.bjp_data;
CREATE POLICY "Allow public read bjp_data" 
ON public.bjp_data 
FOR SELECT 
TO anon, authenticated 
USING (true);

DROP POLICY IF EXISTS "Allow public insert bjp_data" ON public.bjp_data;
CREATE POLICY "Allow public insert bjp_data" 
ON public.bjp_data 
FOR INSERT 
TO anon, authenticated 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update bjp_data" ON public.bjp_data;
CREATE POLICY "Allow public update bjp_data" 
ON public.bjp_data 
FOR UPDATE 
TO anon, authenticated 
USING (true);

DROP POLICY IF EXISTS "Allow public delete bjp_data" ON public.bjp_data;
CREATE POLICY "Allow public delete bjp_data" 
ON public.bjp_data 
FOR DELETE 
TO anon, authenticated 
USING (true);

-- Aktifkan Supabase Realtime agar sinkronisasi antar perangkat kasir & HP owner berjalan otomatis
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'bjp_data'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bjp_data;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. TABEL-TABEL RELASIONAL TAMBAHAN (OPSIONAL UNTUK TABLE EDITOR SUPABASE)
-- ------------------------------------------------------------------------------
-- Di bawah ini adalah struktur tabel relasional standar jika Anda ingin melihat
-- data dalam bentuk tabel baris & kolom di Supabase Table Editor.

-- TABEL OUTLET
CREATE TABLE IF NOT EXISTS public.outlets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all outlets" ON public.outlets;
CREATE POLICY "Allow public all outlets" ON public.outlets FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL PENGGUNA / KASIR / OWNER
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier',
    password TEXT NOT NULL,
    outlet_id TEXT,
    access JSONB DEFAULT '["pos","sales_report","inventory"]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all users" ON public.users;
CREATE POLICY "Allow public all users" ON public.users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL BAHAN BAKU (RAW MATERIALS)
CREATE TABLE IF NOT EXISTS public.raw_materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'buah',
    stock NUMERIC DEFAULT 0,
    stocks JSONB DEFAULT '{}'::jsonb,
    cost_price NUMERIC DEFAULT 0,
    sell_price NUMERIC DEFAULT 0,
    is_addon BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all raw_materials" ON public.raw_materials;
CREATE POLICY "Allow public all raw_materials" ON public.raw_materials FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL PRODUK MENU (PRODUCTS)
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Jus & Minuman',
    cost_price NUMERIC DEFAULT 0,
    price NUMERIC NOT NULL DEFAULT 0,
    stocks JSONB DEFAULT '{}'::jsonb,
    unlimited_outlets JSONB DEFAULT '{}'::jsonb,
    min_stock NUMERIC DEFAULT 5,
    is_unlimited BOOLEAN DEFAULT false,
    recipe JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all products" ON public.products;
CREATE POLICY "Allow public all products" ON public.products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL TRANSAKSI PENJUALAN (TRANSACTIONS)
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    outlet_id TEXT,
    date TIMESTAMPTZ NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal NUMERIC NOT NULL DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    total NUMERIC NOT NULL DEFAULT 0,
    hpp_total NUMERIC DEFAULT 0,
    order_type TEXT DEFAULT 'dine_in',
    customer_note TEXT DEFAULT '',
    status TEXT DEFAULT 'paid',
    payment_method TEXT DEFAULT 'cash',
    cash NUMERIC DEFAULT 0,
    change NUMERIC DEFAULT 0,
    cashier TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all transactions" ON public.transactions;
CREATE POLICY "Allow public all transactions" ON public.transactions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL PENGELUARAN OPERASIONAL (EXPENSES)
CREATE TABLE IF NOT EXISTS public.expenses (
    id TEXT PRIMARY KEY,
    outlet_id TEXT,
    date TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Bahan Baku',
    amount NUMERIC NOT NULL DEFAULT 0,
    payment_source TEXT DEFAULT 'cash',
    operator TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all expenses" ON public.expenses;
CREATE POLICY "Allow public all expenses" ON public.expenses FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL PEMASUKAN SALDO USAHA (INCOMES)
CREATE TABLE IF NOT EXISTS public.incomes (
    id TEXT PRIMARY KEY,
    outlet_id TEXT,
    date TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Modal Tambahan',
    amount NUMERIC NOT NULL DEFAULT 0,
    payment_destination TEXT DEFAULT 'cash',
    operator TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.incomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all incomes" ON public.incomes;
CREATE POLICY "Allow public all incomes" ON public.incomes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL MUTASI TRANSFER INTERNAL (KAS <-> BANK)
CREATE TABLE IF NOT EXISTS public.transfers (
    id TEXT PRIMARY KEY,
    outlet_id TEXT,
    date TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    operator TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all transfers" ON public.transfers;
CREATE POLICY "Allow public all transfers" ON public.transfers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- TABEL PROMO DISKON
CREATE TABLE IF NOT EXISTS public.promos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    discount_nominal NUMERIC NOT NULL DEFAULT 0,
    start_date DATE,
    end_date DATE,
    product_ids JSONB DEFAULT '[]'::jsonb,
    outlet_id TEXT DEFAULT 'all',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);
ALTER TABLE public.promos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all promos" ON public.promos;
CREATE POLICY "Allow public all promos" ON public.promos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- SELESAI
-- Seluruh tabel telah dibuat dan RLS siap digunakan oleh aplikasi BosJusPos.
-- ------------------------------------------------------------------------------
