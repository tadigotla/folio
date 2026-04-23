// One-shot export of `issues` and `issue_slots` rows to a JSON archive,
// run before the magazine-teardown migration drops the tables.
//
// Usage: `tsx scripts/export-issues.ts`
// Output: `backups/issues-pre-teardown.json`

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = path.join(process.cwd(), 'events.db');
const OUT_DIR = path.join(process.cwd(), 'backups');
const OUT_PATH = path.join(OUT_DIR, 'issues-pre-teardown.json');

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name: string } | undefined;
  return !!row;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`events.db not found at ${DB_PATH}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const db = new Database(DB_PATH, { readonly: true });

  const hasIssues = tableExists(db, 'issues');
  const hasSlots = tableExists(db, 'issue_slots');

  const issues = hasIssues ? db.prepare('SELECT * FROM issues').all() : [];
  const slots = hasSlots ? db.prepare('SELECT * FROM issue_slots').all() : [];

  const payload = {
    exported_at: new Date().toISOString(),
    source: 'magazine-teardown',
    issues,
    issue_slots: slots,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));

  console.log(`issues:      ${issues.length} rows`);
  console.log(`issue_slots: ${slots.length} rows`);
  console.log(`wrote ${OUT_PATH}`);
}

main();
