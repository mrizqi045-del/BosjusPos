const fs = require('fs');

const text = fs.readFileSync('D:/Projects/BosJusPos/Database.csv', 'utf8');

function parseCSV(csv) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;
  
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    const next = csv[i + 1];
    
    if (ch === '"') {
      if (inQuotes && next === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      currentRow.push(currentVal);
      currentVal = '';
    } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      currentRow.push(currentVal);
      if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += ch;
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal);
    rows.push(currentRow);
  }
  return rows;
}

const rows = parseCSV(text);
const rawMap = {};
for (let i = 1; i < rows.length; i++) {
  const k = (rows[i][0] || '').trim();
  const v = rows[i][1] !== undefined ? rows[i][1] : '';
  if (k) rawMap[k] = v;
}

console.log('Total raw keys found in CSV:', Object.keys(rawMap).length);

// Reconstruct chunks
const finalMap = {};
for (const k in rawMap) {
  if (k.endsWith('_chunks') || /_c\d+$/.test(k) || k === 'bjp_raw_material_logs_v7_chunk') continue;
  
  const chunkCountKey = k + '_chunks';
  if (rawMap[chunkCountKey] && parseInt(rawMap[chunkCountKey], 10) > 0) {
    const n = parseInt(rawMap[chunkCountKey], 10);
    let full = '';
    for (let c = 0; c < n; c++) {
      full += rawMap[k + '_c' + c] || '';
    }
    finalMap[k] = full;
    console.log('Reconstructed chunked key:', k, '-> total size:', full.length, 'characters');
  } else if (rawMap[k] !== '[CHUNKED]') {
    finalMap[k] = rawMap[k];
  }
}

// Check raw_material_logs chunk key naming
if (rawMap['bjp_raw_material_logs_v7_chunk'] && !finalMap['bjp_raw_material_logs_v7']) {
  const n = parseInt(rawMap['bjp_raw_material_logs_v7_chunk'], 10);
  let full = '';
  for (let c = 0; c < n; c++) {
    full += rawMap['bjp_raw_material_logs_v7_c' + c] || '';
  }
  finalMap['bjp_raw_material_logs_v7'] = full;
  console.log('Reconstructed bjp_raw_material_logs_v7 -> total size:', full.length, 'characters');
}

console.log('\n--- DAFTAR DATA YANG BERHASIL DIEKSTRAK & DIRAKIT ---');
for (const k in finalMap) {
  console.log(`- ${k}: ${finalMap[k].length} bytes`);
}

fs.writeFileSync('D:/Projects/BosJusPos/export_clean.json', JSON.stringify(finalMap, null, 2), 'utf8');
console.log('\nBerhasil membuat file bersih: D:/Projects/BosJusPos/export_clean.json');
