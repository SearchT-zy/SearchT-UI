import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { ISqliteDriver, IStatement } from '@process/services/database/drivers/ISqliteDriver';

export class NodeSqliteDriver implements ISqliteDriver {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  prepare(sql: string): IStatement {
    const statement = this.database.prepare(sql);
    return {
      get: (...args) => statement.get(...toSqlParameters(args)),
      all: (...args) => statement.all(...toSqlParameters(args)),
      run: (...args) => {
        const result = statement.run(...toSqlParameters(args));
        return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
      },
    };
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  pragma(sql: string, options?: { simple?: boolean }): unknown {
    const rows = this.database.prepare(`PRAGMA ${sql}`).all();
    if (!options?.simple) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args: unknown[]): T => {
      if (this.database.isTransaction) return fn(...args);
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close(): void {
    this.database.close();
  }
}

function toSqlParameters(values: readonly unknown[]): SQLInputValue[] {
  return values as SQLInputValue[];
}
