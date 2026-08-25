import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDriver } from '@process/resources/builtinMcp/memoryMcpDriver';
import { MemoryService } from '@process/services/personal-core/memory/MemoryService';
import { migratePersonalSchema } from '@process/services/personal-core/schema';

const directories: string[] = [];

function openDriver(): NodeSqliteDriver {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-memory-mcp-driver-'));
  directories.push(directory);
  return new NodeSqliteDriver(path.join(directory, 'personal.db'));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('NodeSqliteDriver', () => {
  it('runs the Personal Core memory service under the standalone Node ABI', () => {
    const driver = openDriver();
    try {
      migratePersonalSchema(driver, 0);
      let id = 0;
      const service = new MemoryService(driver, { now: () => 100, randomUUID: () => `id-${++id}` });
      const memory = service.createMemory({
        content: 'Workspace weekly summary preference',
        memoryType: 'preference',
        scope: { kind: 'workspace', id: 'workspace-1' },
        sensitivity: 'normal',
        confidence: 0.9,
        reason: 'User added',
        expiresAt: null,
        reviewAt: null,
      });

      expect(
        service.retrieve({
          query: 'weekly',
          scopes: [{ kind: 'workspace', id: 'workspace-1' }],
          includeSensitive: false,
        }).hits[0]?.memory.id
      ).toBe(memory.id);
    } finally {
      driver.close();
    }
  });

  it('rolls back a failed transaction', () => {
    const driver = openDriver();
    try {
      driver.exec('CREATE TABLE values_test (id TEXT PRIMARY KEY)');
      expect(() =>
        driver.transaction(() => {
          driver.prepare('INSERT INTO values_test (id) VALUES (?)').run('one');
          throw new Error('stop');
        })()
      ).toThrow('stop');
      expect(driver.prepare('SELECT COUNT(*) AS count FROM values_test').get()).toEqual({ count: 0 });
    } finally {
      driver.close();
    }
  });
});
