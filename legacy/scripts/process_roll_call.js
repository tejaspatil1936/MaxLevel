const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const filePath = path.join(__dirname, '../data/TY_COMPUTER_ROLL CALL_LIST_2026-27_SEM-I.xlsx');
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

const wb = xlsx.readFile(filePath);

function cleanPrn(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (s === '202400140101') return '202401040101';
  if (s === '20401040355') return '202401040355';
  if (/^20\d{9,10}$/.test(s)) return s;
  return null;
}

function cleanStudentName(rawName) {
  if (!rawName) return '';
  let name = String(rawName).trim();
  // Normalize internal whitespace
  name = name.replace(/\s+/g, ' ');

  // Split into words
  let words = name.split(' ');

  // Deduplicate consecutive identical words (e.g. "GANESH GANESH" -> "GANESH")
  const dedupedWords = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && words[i].toUpperCase() === words[i - 1].toUpperCase()) {
      continue;
    }
    dedupedWords.push(words[i]);
  }
  words = dedupedWords;

  // Deduplicate first word == last word if 3+ words (e.g. "KHARE AAKANKSHA VIJAY KHARE" -> "KHARE AAKANKSHA VIJAY")
  if (words.length >= 3 && words[0].toUpperCase() === words[words.length - 1].toUpperCase()) {
    words.pop();
  }

  // Deduplicate if first 2 words repeated at end (e.g. "SURNAME NAME FATHER SURNAME NAME")
  if (words.length >= 4 && words[0].toUpperCase() === words[words.length - 2].toUpperCase() && words[1].toUpperCase() === words[words.length - 1].toUpperCase()) {
    words.splice(words.length - 2, 2);
  }

  // Return standard uppercase clean name
  return words.join(' ').trim().toUpperCase();
}

const students = [];
const seenPrns = new Set();
const seenRolls = new Set();

// 1. Division A: Rows 7 to 84 (Roll 1 to 78)
const divA = xlsx.utils.sheet_to_json(wb.Sheets['Div-A'], { header: 1 });
for (let i = 7; i <= 84; i++) {
  const r = divA[i];
  if (r && r[1]) {
    const roll = Number(r[1]);
    const prn = cleanPrn(r[2]);
    if (!prn) {
      console.warn('Invalid PRN in Div A row', i, r);
      continue;
    }
    const name = cleanStudentName(r[3]);
    const batch = String(r[4] || 'A1').trim().toUpperCase();
    const div = 'A';
    const vsec = String(r[6] || '').trim();
    const pec = String(r[7] || '').trim();
    students.push({ roll, prn, name, email: `${prn.toLowerCase()}@mitaoe.ac.in`, div, batch, vsec, pec });
    seenPrns.add(prn);
    seenRolls.add(roll);
  }
}

// 2. Division B: Rows 5, 6, rows 90 to 142 (excluding stray filtered duplicates 100, 102, 104, 122, 123, 126, 131, 134), and rows 160 to 190
const divB = xlsx.utils.sheet_to_json(wb.Sheets['DIV-B'], { header: 1 });
const strayBRowIndices = new Set([100, 102, 104, 122, 123, 126, 131, 134]);
const bRows = [];
bRows.push(divB[5]);
bRows.push(divB[6]);
for (let i = 90; i <= 142; i++) {
  if (!strayBRowIndices.has(i)) {
    bRows.push(divB[i]);
  }
}
for (let i = 160; i <= 190; i++) {
  bRows.push(divB[i]);
}

bRows.forEach((r, idx) => {
  if (r && r[1]) {
    const roll = Number(r[1]);
    const prn = cleanPrn(r[2]);
    if (!prn) {
      console.warn('Invalid PRN in Div B row', idx, r);
      return;
    }
    const name = cleanStudentName(r[3]);
    const batch = String(r[4] || 'B1').trim().toUpperCase();
    const div = 'B';
    const vsec = String(r[7] || r[6] || '').trim();
    const pec = String(r[8] || '').trim();
    students.push({ roll, prn, name, email: `${prn.toLowerCase()}@mitaoe.ac.in`, div, batch, vsec, pec });
    seenPrns.add(prn);
    seenRolls.add(roll);
  }
});

// 3. Division C: Rows 8 to 85 (Roll 157 to 234)
const divC = xlsx.utils.sheet_to_json(wb.Sheets['DIV-C'], { header: 1 });
for (let i = 8; i <= 85; i++) {
  const r = divC[i];
  if (r && r[1]) {
    const roll = Number(r[1]);
    const prn = cleanPrn(r[2]);
    if (!prn) {
      console.warn('Invalid PRN in Div C row', i, r);
      continue;
    }
    const name = cleanStudentName(r[3]);
    const batch = String(r[4] || 'C1').trim().toUpperCase();
    const div = 'C';
    const vsec = String(r[7] || r[6] || '').trim();
    const pec = String(r[8] || '').trim();
    students.push({ roll, prn, name, email: `${prn.toLowerCase()}@mitaoe.ac.in`, div, batch, vsec, pec });
    seenPrns.add(prn);
    seenRolls.add(roll);
  }
}

// 4. Division D: Rows 6 to 81 (Roll 235 to 310)
const divD = xlsx.utils.sheet_to_json(wb.Sheets['DIV-D'], { header: 1 });
for (let i = 6; i <= 81; i++) {
  const r = divD[i];
  if (r && r[1]) {
    const roll = Number(r[1]);
    const prn = cleanPrn(r[2]);
    if (!prn) {
      console.warn('Invalid PRN in Div D row', i, r);
      continue;
    }
    const name = cleanStudentName(r[3]);
    const batch = String(r[4] || 'D1').trim().toUpperCase();
    const div = 'D';
    const vsec = String(r[7] || r[6] || '').trim();
    const pec = String(r[8] || '').trim();
    students.push({ roll, prn, name, email: `${prn.toLowerCase()}@mitaoe.ac.in`, div, batch, vsec, pec });
    seenPrns.add(prn);
    seenRolls.add(roll);
  }
}

// 5. Division E: Rows 7 to 87 (Roll 311 to 391)
const divE = xlsx.utils.sheet_to_json(wb.Sheets['DIV-E'], { header: 1 });
for (let i = 7; i <= 87; i++) {
  const r = divE[i];
  if (r && r[0]) {
    const roll = Number(r[0]);
    const prn = cleanPrn(r[1]);
    if (!prn) {
      console.warn('Invalid PRN in Div E row', i, r);
      continue;
    }
    const name = cleanStudentName(r[2]);
    const batch = String(r[3] || 'E1').trim().toUpperCase();
    const div = 'E';
    const vsec = String(r[6] || r[5] || '').trim();
    const pec = String(r[8] || r[7] || '').trim();
    students.push({ roll, prn, name, email: `${prn.toLowerCase()}@mitaoe.ac.in`, div, batch, vsec, pec });
    seenPrns.add(prn);
    seenRolls.add(roll);
  }
}

console.log('Official division roll call students extracted:', students.length);
console.log('Min roll:', Math.min(...Array.from(seenRolls)));
console.log('Max roll:', Math.max(...Array.from(seenRolls)));

// 6. Include remaining 5 unallocated batch students so they are whitelisted for exams
const extraStudents = [
  { prn: '202401040031', name: 'KARTIK SHARMA' },
  { prn: '202401040079', name: 'RASVE TEJASVINI VIKRAM' },
  { prn: '202401040088', name: 'DEORE ADITYA VISHAL' },
  { prn: '202401040150', name: 'KHAMKAR VEDANT AMOL' },
  { prn: '202401040353', name: 'PAINAPALLE SAIPRASAD MADHAVRAO' }
];

let nextRoll = 392;
extraStudents.forEach(ext => {
  if (!seenPrns.has(ext.prn)) {
    students.push({
      roll: nextRoll++,
      prn: ext.prn,
      name: cleanStudentName(ext.name),
      email: `${ext.prn.toLowerCase()}@mitaoe.ac.in`,
      div: 'UNALLOCATED',
      batch: 'UNALLOCATED',
      vsec: '',
      pec: ''
    });
    seenPrns.add(ext.prn);
  }
});

console.log('Total students including unallocated:', students.length);

// Sort students by roll number
students.sort((a, b) => a.roll - b.roll);

// Validation check
let errorCount = 0;
const prnCheck = new Map();
students.forEach(s => {
  if (prnCheck.has(s.prn)) {
    console.error('Duplicate PRN found:', s.prn);
    errorCount++;
  }
  prnCheck.set(s.prn, true);

  if (!s.name || s.name.length < 3) {
    console.error('Invalid name for PRN:', s.prn, s.name);
    errorCount++;
  }

  if (!s.email.endsWith('@mitaoe.ac.in') || s.email.includes(' ')) {
    console.error('Invalid email for PRN:', s.prn, s.email);
    errorCount++;
  }
});

if (errorCount > 0) {
  console.error(`Validation failed with ${errorCount} errors.`);
  process.exit(1);
}

console.log('All integrity and format validations passed successfully!');

function escapeCsv(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// 1. Output canonical eligibility CSV (prn,name,email)
const eligibilityCsvRows = [
  'prn,name,email',
  ...students.map(s => `${escapeCsv(s.prn)},${escapeCsv(s.name)},${escapeCsv(s.email)}`)
];

const eligibilityCsvPath = path.join(__dirname, '../data/ty_computer_eligibility_cleaned.csv');
fs.writeFileSync(eligibilityCsvPath, eligibilityCsvRows.join('\r\n'), 'utf8');
console.log('Wrote canonical eligibility CSV:', eligibilityCsvPath, `(${students.length} rows)`);

// 2. Output official 391 roll call only CSV (for division lists / faculty records)
const official391Rows = [
  'prn,name,email',
  ...students.slice(0, 391).map(s => `${escapeCsv(s.prn)},${escapeCsv(s.name)},${escapeCsv(s.email)}`)
];
const officialCsvPath = path.join(__dirname, '../data/ty_computer_roll_call_391.csv');
fs.writeFileSync(officialCsvPath, official391Rows.join('\r\n'), 'utf8');
console.log('Wrote official 391 roll call CSV:', officialCsvPath, '(391 rows)');

// 3. Output full academic roster CSV (roll_number,prn,name,email,division,batch,vsec_course,pec_track)
const fullRosterRows = [
  'roll_number,prn,name,email,division,batch,vsec_course,pec_track',
  ...students.map(s => [
    escapeCsv(s.roll <= 391 ? s.roll : 'N/A'),
    escapeCsv(s.prn),
    escapeCsv(s.name),
    escapeCsv(s.email),
    escapeCsv(s.div),
    escapeCsv(s.batch),
    escapeCsv(s.vsec),
    escapeCsv(s.pec)
  ].join(','))
];

const fullRosterPath = path.join(__dirname, '../data/ty_computer_full_roster_2026_27.csv');
fs.writeFileSync(fullRosterPath, fullRosterRows.join('\r\n'), 'utf8');
console.log('Wrote full academic roster CSV:', fullRosterPath, `(${students.length} rows)`);
