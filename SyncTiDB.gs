// =====================================================================
// SINKRONISASI OTOMATIS: TIDB CLOUD -> GOOGLE SPREADSHEET BOS JUS
// Termasuk: Penjualan, Pengeluaran, Pemasukan, dan Mutasi Office Outlet
// =====================================================================

const SPREADSHEET_ID_BOSJUS = '1NLjrGbzKrnZERmm1o8_fUztevVaYhWsG7JDtsPXWR7o';
const TIDB_API_URL = 'https://bosjuspos.vercel.app/api/data?action=getData';

function syncTiDBToSpreadsheet() {
  try {
    const res = UrlFetchApp.fetch(TIDB_API_URL, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    if (!json || json.status !== 'success' || !json.data) {
      throw new Error('Gagal mengambil data dari TiDB Cloud: ' + res.getContentText());
    }

    const data = json.data;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_BOSJUS);

    // 1. Perbarui Sheet "penjualan"
    if (data['bjp_transactions_v7']) {
      try {
        updateSheetPenjualan(ss, JSON.parse(data['bjp_transactions_v7'] || '[]'));
      } catch (e) {
        Logger.log('Error updateSheetPenjualan: ' + e.message);
      }
    }

    // 2. Perbarui Sheet "Pengeluaran" & "Pemasukan"
    if (data['bjp_finance_v7']) {
      try {
        const fin = JSON.parse(data['bjp_finance_v7'] || '{}');
        if (fin.expenses) updateSheetPengeluaran(ss, fin.expenses);
        if (fin.incomes) updateSheetPemasukan(ss, fin.incomes);
      } catch (e) {
        Logger.log('Error updateSheetFinance: ' + e.message);
      }
    }

    // 3. Perbarui Sheet "mutasi office outlet"
    try {
      const posTr = JSON.parse(data['bjp_transfers_v7'] || '[]');
      const offTr = JSON.parse(data['ownerOfficeTransfers'] || data['bjp_office_transfers_v7'] || '[]');
      updateSheetMutasiOffice(ss, posTr, offTr);
    } catch (e) {
      Logger.log('Error updateSheetMutasiOffice: ' + e.message);
    }

    ss.toast('Sinkronisasi TiDB Cloud selesai sukses!', 'Sukses', 5);
  } catch (err) {
    Logger.log('Error Sync: ' + err.message);
    SpreadsheetApp.openById(SPREADSHEET_ID_BOSJUS).toast('Error: ' + err.message, 'Gagal', 5);
  }
}

// Format Tanggal WIB (Asia/Jakarta)
function formatTgl(dateVal, includeSeconds) {
  if (!dateVal) return '-';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const pattern = includeSeconds ? 'dd/MM/yyyy HH:mm:ss' : 'dd/MM/yyyy HH:mm';
    return Utilities.formatDate(d, 'Asia/Jakarta', pattern);
  } catch (e) {
    return String(dateVal);
  }
}

// 1. Sheet Penjualan
function updateSheetPenjualan(ss, transactions) {
  let sheet = ss.getSheetByName('penjualan') || ss.getSheetByName('Transaksi');
  if (!sheet) sheet = ss.insertSheet('penjualan');

  const headers = [
    'No Invoice', 'Tanggal & Jam', 'Kasir', 'Outlet ID', 'Tipe Layanan',
    'Status', 'Total Cup', 'Total Tagihan (Rp)', 'Diskon (Rp)', 'Metode Bayar',
    'Jumlah Bayar (Rp)', 'Kembalian (Rp)', 'Total HPP (Rp)', 'Split Tunai (Rp)',
    'Split Non-Tunai (Rp)', 'Metode Non-Tunai', 'Info / Catatan Meja', 'Rincian Item'
  ];

  const rows = transactions.map(t => {
    const dateStr = formatTgl(t.date, true);
    const cupCount = (t.items || []).reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
    const itemsSummary = (t.items || []).map(i => `${i.name || 'Item'} (${i.qty || 1}x @${i.price || 0})`).join('; ');

    let payMethod = String(t.paymentMethod || '-').toUpperCase();
    let spCash = '', spNonCash = '', spNonMethod = '';
    if (payMethod === 'SPLIT' && t.splitPayment) {
      spCash = Number(t.splitPayment.cash) || 0;
      spNonCash = Number(t.splitPayment.nonCashAmount || t.splitPayment.qris || t.splitPayment.transfer || t.splitPayment.online) || 0;
      spNonMethod = String(t.splitPayment.nonCashMethod || 'QRIS').toUpperCase();
    }

    return [
      t.id || '',
      dateStr,
      t.cashier || 'Kasir',
      t.outletId || '-',
      t.orderType || 'dine_in',
      (t.status || 'paid') === 'pending' ? 'BELUM DIBAYAR' : 'LUNAS',
      cupCount,
      Number(t.total) || 0,
      Number(t.discount) || 0,
      payMethod,
      Number(t.amountPaid) || 0,
      Number(t.change) || 0,
      Number(t.hppTotal) || 0,
      spCash,
      spNonCash,
      spNonMethod,
      t.customerNote || '-',
      itemsSummary || '-'
    ];
  });

  renderTableData(sheet, headers, rows, '#166534');
}

// 2. Sheet Pengeluaran
function updateSheetPengeluaran(ss, expenses) {
  let sheet = ss.getSheetByName('Pengeluaran') || ss.getSheetByName('pengeluaran');
  if (!sheet) sheet = ss.insertSheet('Pengeluaran');

  const headers = ['ID Biaya', 'Tanggal', 'Kategori Biaya', 'Keterangan', 'Sumber Dana', 'Nominal (Rp)', 'Kasir / Petugas', 'Outlet ID'];
  const rows = expenses.map(e => {
    return [
      e.id || '',
      formatTgl(e.date, true),
      e.category || '-',
      e.title || e.note || '-',
      e.paymentSource === 'bank' ? 'Rekening Bank' : 'Kas Tunai',
      Number(e.amount) || 0,
      e.cashier || e.operator || '-',
      e.outletId || '-'
    ];
  });

  renderTableData(sheet, headers, rows, '#991b1b');
}

// 3. Sheet Pemasukan
function updateSheetPemasukan(ss, incomes) {
  let sheet = ss.getSheetByName('Pemasukan') || ss.getSheetByName('pemasukan');
  if (!sheet) sheet = ss.insertSheet('Pemasukan');

  const headers = ['ID Pemasukan', 'Tanggal', 'Kategori', 'Keterangan / Sumber', 'Tujuan Saldo', 'Nominal (Rp)', 'Dicatat Oleh', 'Outlet ID'];
  const rows = incomes.map(i => {
    return [
      i.id || '',
      formatTgl(i.date, true),
      i.category || 'Modal',
      i.title || i.note || '-',
      i.paymentDestination === 'bank' ? 'Rekening Bank' : 'Kas Tunai',
      Number(i.amount) || 0,
      i.operator || i.cashier || '-',
      i.outletId || '-'
    ];
  });

  renderTableData(sheet, headers, rows, '#047857');
}

// 4. Sheet Mutasi Office & Outlet
function updateSheetMutasiOffice(ss, posTransfers, officeTransfers) {
  let sheet = ss.getSheetByName('mutasi office outlet') || 
              ss.getSheetByName('Mutasi Office Outlet') || 
              ss.getSheetByName('mutasi_office_outlet');
  if (!sheet) sheet = ss.insertSheet('mutasi office outlet');

  const map = new Map();
  (posTransfers || []).filter(t => t && t.type && (t.type.includes('office') || t.direction)).forEach(t => map.set(t.id, t));
  (officeTransfers || []).forEach(t => { if (t && t.id) map.set(t.id, t); });

  const list = Array.from(map.values()).map(t => {
    let dir = t.direction || t.dir || t.type;
    if (dir === 'cash_to_office' || dir === 'bank_to_office') dir = 'outlet_to_office';
    if (dir === 'office_to_cash' || dir === 'office_to_bank') dir = 'office_to_outlet';

    const isCash = t.fundType === 'cash' || t.type === 'cash_to_office' || t.type === 'office_to_cash' || t.from === 'cash' || t.to === 'cash';

    let directionLabel = 'Outlet -> Office (Setoran)';
    let sourceLabel = (t.outletName || 'Outlet') + ' (' + (isCash ? 'Kas Laci' : 'Bank') + ')';
    let targetLabel = 'Kas Pusat Office (' + (isCash ? 'Kas Fisik' : 'Bank') + ')';
    let fundLabel = isCash ? 'Kas Fisik (Tunai)' : 'Rekening Bank';
    let outletCol = t.outletName || 'Outlet Utama';

    if (dir === 'office_to_outlet') {
      directionLabel = 'Office -> Outlet (Dropping)';
      sourceLabel = 'Kas Pusat Office (' + (isCash ? 'Kas Fisik' : 'Bank') + ')';
      targetLabel = (t.outletName || 'Outlet') + ' (' + (isCash ? 'Kas Laci' : 'Bank') + ')';
      outletCol = t.outletName || 'Outlet Utama';
    } else if (dir === 'office_bank_to_cash') {
      directionLabel = 'Bank -> Kas Office';
      sourceLabel = 'Rekening Bank Office (Pusat)';
      targetLabel = 'Kas Fisik Office (Pusat)';
      fundLabel = 'Internal Office (Tarik Tunai)';
      outletCol = 'Office Pusat (Internal)';
    } else if (dir === 'office_cash_to_bank') {
      directionLabel = 'Kas -> Bank Office';
      sourceLabel = 'Kas Fisik Office (Pusat)';
      targetLabel = 'Rekening Bank Office (Pusat)';
      fundLabel = 'Internal Office (Setor Tunai)';
      outletCol = 'Office Pusat (Internal)';
    } else if (dir === 'office_direct_in') {
      directionLabel = '+ Kas Masuk Office';
      sourceLabel = t.category ? 'Pemasukan (' + t.category + ')' : 'Penerimaan Langsung Office';
      targetLabel = isCash ? 'Kas Fisik Office (Pusat)' : 'Rekening Bank Office (Pusat)';
      outletCol = 'Office Pusat (Internal)';
    } else if (dir === 'office_direct_out') {
      directionLabel = '- Kas Keluar Office';
      sourceLabel = isCash ? 'Kas Fisik Office (Pusat)' : 'Rekening Bank Office (Pusat)';
      targetLabel = t.category ? 'Pengeluaran (' + t.category + ')' : 'Biaya Langsung Office';
      outletCol = 'Office Pusat (Internal)';
    }

    let note = t.note || '-';
    if (t.category && !note.includes(t.category)) {
      note += ' [' + t.category + ']';
    }

    return {
      date: t.date,
      directionLabel: directionLabel,
      outletCol: outletCol,
      fundLabel: fundLabel,
      sourceLabel: sourceLabel,
      targetLabel: targetLabel,
      amount: Number(t.amount) || 0,
      note: note,
      operator: t.operator || '-'
    };
  }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const headers = [
    'Tanggal & Waktu',
    'Arah Mutasi',
    'Cabang Outlet',
    'Jenis Dana',
    'Sumber Dana (Dari)',
    'Tujuan Dana (Ke)',
    'Nominal (Rp)',
    'Keterangan',
    'Dicatat Oleh'
  ];

  const rows = list.map(tr => [
    formatTgl(tr.date, false),
    tr.directionLabel,
    tr.outletCol,
    tr.fundLabel,
    tr.sourceLabel,
    tr.targetLabel,
    tr.amount,
    tr.note,
    tr.operator
  ]);

  renderTableData(sheet, headers, rows, '#1e3a8a');
}

// Helper Tulis Data Cepat & Bersih
function renderTableData(sheet, headers, rows, headerColor) {
  const lastRow = sheet.getLastRow();
  const maxCols = Math.max(sheet.getLastColumn(), headers.length);
  if (lastRow > 1 && maxCols > 0) {
    sheet.getRange(2, 1, lastRow - 1, maxCols).clearContent();
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground(headerColor)
    .setFontColor('#ffffff');

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

// Menu di Google Sheets
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Sync TiDB Cloud')
    .addItem('Tarik Data Terbaru Sekarang', 'syncTiDBToSpreadsheet')
    .addToUi();
}
