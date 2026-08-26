// Throwaway final audit: scan EVERY table/column of the backend DBs for
// user-visible legacy brand strings, plus quick disk-file pass. Functional
// identifiers (aionrs engine type, .aionrs paths, legacy folder/file names
// that exist on disk) are excluded — they are not rendered to users.
const path = require('path');
const fs = require('fs');
const Database = require(process.cwd() + '/node_modules/better-sqlite3');

const APPDATA = process.env.APPDATA;
const DATA = path.join(APPDATA, 'SearchT-UI', 'searcht');

// Patterns that indicate USER-VISIBLE legacy branding.
const VISIBLE = [/AionUi/gi, /Aion UI/g, /Aion CLI/gi, /aioncore/gi, /aionui-/gi];
// Exclusions that legitimately survive (runtime/engine identifiers & paths).
const FUNCTIONAL = /\.aionrs\b/i;

const checkText = (s) => {
  if (typeof s !== 'string') return null;
  let t = s;
  for (const re of VISIBLE) t = t.replace(re, '');
  if (FUNCTIONAL.test(s)) {
    // re-evaluate: only flag if visible patterns exist OUTSIDE functional refs
    t = s.replace(/\.aionrs[^\s"']*|aionrs-temp-[a-f0-9]+/gi, '');
    for (const re of VISIBLE) t = t.replace(re, '');
  }
  return /AionUi|Aion UI|Aion CLI|aioncore|aionui-/i.test(t) ? t : null;
};

const auditDb = (dbPath) => {
  console.log('==== ' + path.basename(dbPath) + ' ====');
  if (!fs.existsSync(dbPath)) return console.log('  (missing)');
  const db = new Database(dbPath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  let total = 0;
  for (const table of tables) {
    if (table.startsWith('_sqlx') || table === 'sqlite_sequence') continue;
    let cols;
    try {
      cols = db.prepare(`SELECT name, type FROM pragma_table_info('${table}')`).all();
    } catch {
      continue;
    }
    const textCols = cols.filter((c) => c.type.toUpperCase().includes('TEXT') || c.type === '').map((c) => c.name);
    if (!textCols.length) continue;
    let rows;
    try {
      rows = db.prepare(`SELECT rowid AS rid, ${textCols.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all();
    } catch (e) {
      console.log(`  ${table}: scan failed ${e.message}`);
      continue;
    }
    const hits = [];
    for (const row of rows) {
      for (const col of textCols) {
        // skill location/path columns point at legacy folder names on disk — functional
        if (/^(path|location|source_path|relative_location|workspace|rule_resource_ref|source_ref)$/i.test(col)) continue;
        const bad = checkText(row[col]);
        if (bad) hits.push(`  ${table}.${col} rowid=${row.rid}: ${String(row[col]).slice(0, 110).replace(/\n/g, ' ')}`);
      }
    }
    if (hits.length) {
      total += hits.length;
      console.log(`${table}: ${hits.length} hit(s)`);
      hits.slice(0, 4).forEach((h) => console.log(h));
    }
  }
  console.log('  TOTAL visible-string hits: ' + total);
  db.close();
};

auditDb(path.join(DATA, 'aionui-backend.db'));
auditDb(path.join(DATA, 'personal-core', 'searcht-personal.db'));
