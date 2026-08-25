import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { SearchtImportReport } from '@/common/types/searcht/workspace';
import type { SearchtMigrationFileIO, RollbackJournal } from './SearchtMigrationService';

type ReportRow = {
  id: string;
  status: SearchtImportReport['status'];
  report_json: string;
  rollback_json: string;
  created_at: number;
  updated_at: number;
};

export class SqliteSearchtImportReportStore {
  constructor(
    private readonly driver: ISqliteDriver,
    private readonly now: () => number = Date.now
  ) {}

  save(report: SearchtImportReport, journal: RollbackJournal): void {
    const now = this.now();
    this.driver
      .prepare(`INSERT INTO searcht_import_reports (id, status, report_json, rollback_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, report_json = excluded.report_json,
          rollback_json = excluded.rollback_json, updated_at = excluded.updated_at`)
      .run(report.id, report.status, JSON.stringify(report), JSON.stringify(journal), now, now);
  }

  load(id: string): { report: SearchtImportReport; journal: RollbackJournal } | null {
    const row = this.driver.prepare('SELECT * FROM searcht_import_reports WHERE id = ?').get(id) as
      | ReportRow
      | undefined;
    if (!row) return null;
    return {
      report: JSON.parse(row.report_json) as SearchtImportReport,
      journal: JSON.parse(row.rollback_json) as RollbackJournal,
    };
  }

  listRecent(limit = 10): SearchtImportReport[] {
    const rows = this.driver
      .prepare('SELECT report_json FROM searcht_import_reports ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as Array<{ report_json: string }>;
    return rows.map((row) => JSON.parse(row.report_json) as SearchtImportReport);
  }

  markRolledBack(id: string, report: SearchtImportReport): void {
    this.driver
      .prepare('UPDATE searcht_import_reports SET status = ?, report_json = ?, updated_at = ? WHERE id = ?')
      .run(report.status, JSON.stringify(report), this.now(), id);
  }
}

/** Node fs-backed adapter. All paths come from trusted internal callers. */
export class NodeSearchtMigrationFileIO implements SearchtMigrationFileIO {
  exists(target: string): boolean {
    return existsSync(target);
  }

  readFile(target: string): string {
    return readFileSync(target, 'utf8');
  }

  writeFile(target: string, data: string): void {
    writeFileSync(target, data, 'utf8');
  }

  listFiles(directory: string): string[] {
    return readdirSync(directory);
  }

  isDirectory(target: string): boolean {
    return statSync(target).isDirectory();
  }

  ensureDirectory(directory: string): void {
    mkdirSync(directory, { recursive: true });
  }

  copyFile(from: string, to: string): void {
    const temporary = `${to}.searcht-import-${Date.now()}.tmp`;
    writeFileSync(temporary, readFileSync(from));
    renameSync(temporary, to);
  }

  removeFile(target: string): void {
    unlinkSync(target);
  }
}
