import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';
import { InboxService } from '@process/services/personal-core/InboxService';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { LocalFolderConnectorService } from '@process/services/personal-core/connectors/LocalFolderConnectorService';

let directory: string;
let sourceDirectory: string;
let database: PersonalDatabase;
let inbox: InboxService;
let service: LocalFolderConnectorService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-folder-connector-'));
  sourceDirectory = path.join(directory, 'incoming');
  mkdirSync(sourceDirectory);
  database = PersonalDatabase.open(directory);
  inbox = new InboxService(database.driver, new InboxFileStore(path.join(directory, 'personal-core', 'inbox')));
  service = new LocalFolderConnectorService(database.driver, inbox);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function createConnection(includeSubfolders = false) {
  return service.create(
    { kind: 'local-folder', path: sourceDirectory, includeSubfolders, displayName: '资料入口' },
    100
  );
}

describe('LocalFolderConnectorService', () => {
  it('creates and lists a normalized local-folder connection', () => {
    const created = createConnection();

    expect(created).toMatchObject({
      kind: 'local-folder',
      displayName: '资料入口',
      state: 'active',
      config: { path: path.resolve(sourceDirectory), includeSubfolders: false },
    });
    expect(service.list()).toEqual([created]);
  });

  it('imports a new file once and skips it while unchanged', async () => {
    const filePath = path.join(sourceDirectory, 'brief.md');
    writeFileSync(filePath, 'first draft');
    const connection = createConnection();

    const first = await service.sync(connection.id, 200);
    const second = await service.sync(connection.id, 300);

    expect(first).toMatchObject({ scanned: 1, imported: 1, reused: 0, skipped: 0, failed: 0 });
    expect(second).toMatchObject({ scanned: 1, imported: 0, reused: 0, skipped: 1, failed: 0 });
    expect(inbox.list({ view: 'pending' }).total).toBe(1);
  });

  it('imports a changed file as a new Inbox item while retaining its original path', async () => {
    const filePath = path.join(sourceDirectory, 'changing.txt');
    writeFileSync(filePath, 'one');
    const connection = createConnection();
    await service.sync(connection.id, 200);
    writeFileSync(filePath, 'a longer second version');

    const result = await service.sync(connection.id, 300);
    const items = inbox.list({ view: 'pending' }).items;

    expect(result).toMatchObject({ scanned: 1, imported: 1, skipped: 0, failed: 0 });
    expect(items).toHaveLength(2);
    expect(items.map((item) => inbox.get(item.id)?.origin?.originalPath)).toEqual([filePath, filePath]);
  });

  it('only includes nested files when subfolder scanning is enabled', async () => {
    const nestedDirectory = path.join(sourceDirectory, 'nested');
    mkdirSync(nestedDirectory);
    writeFileSync(path.join(sourceDirectory, 'root.txt'), 'root');
    writeFileSync(path.join(nestedDirectory, 'nested.txt'), 'nested');
    const flat = createConnection(false);

    const flatResult = await service.sync(flat.id, 200);
    service.disconnect(flat.id, 210);
    const recursive = createConnection(true);
    const recursiveResult = await service.sync(recursive.id, 300);

    expect(flatResult.scanned).toBe(1);
    expect(recursiveResult.scanned).toBe(2);
    expect(recursiveResult).toMatchObject({ imported: 2, reused: 1, failed: 0 });
  });

  it('skips hidden directories during recursive scans', async () => {
    const hiddenDirectory = path.join(sourceDirectory, '.private');
    mkdirSync(hiddenDirectory);
    writeFileSync(path.join(hiddenDirectory, 'secret.txt'), 'secret');
    const connection = createConnection(true);

    const result = await service.sync(connection.id, 200);

    expect(result).toMatchObject({ scanned: 0, imported: 0, skipped: 0, failed: 0 });
    expect(inbox.list({ view: 'pending' }).total).toBe(0);
  });

  it('blocks paused connections and resumes syncing after activation', async () => {
    writeFileSync(path.join(sourceDirectory, 'later.txt'), 'later');
    const connection = createConnection();
    const paused = service.setState({ id: connection.id, state: 'paused' }, 200);

    await expect(service.sync(connection.id, 210)).rejects.toThrow('CONNECTOR_PAUSED');
    expect(paused.state).toBe('paused');

    service.setState({ id: connection.id, state: 'active' }, 220);
    const result = await service.sync(connection.id, 230);
    expect(result.imported).toBe(1);
  });

  it('shares one in-flight scan between overlapping sync requests', async () => {
    writeFileSync(path.join(sourceDirectory, 'single.txt'), 'single');
    let releaseImport: (() => void) | undefined;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    let importCalls = 0;
    const lockedService = new LocalFolderConnectorService(database.driver, {
      importFiles: async (input, now) => {
        importCalls += 1;
        await importGate;
        return inbox.importFiles(input, now);
      },
    });
    const connection = lockedService.create(
      { kind: 'local-folder', path: sourceDirectory, includeSubfolders: false },
      100
    );

    const first = lockedService.sync(connection.id, 200);
    const second = lockedService.sync(connection.id, 201);
    releaseImport?.();

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(importCalls).toBe(1);
  });

  it('marks the connection as needing attention when its folder disappears', async () => {
    const connection = createConnection();
    rmSync(sourceDirectory, { recursive: true, force: true });

    await expect(service.sync(connection.id, 200)).rejects.toThrow('CONNECTOR_FOLDER_UNAVAILABLE');

    expect(service.list()[0]).toMatchObject({
      state: 'error',
      lastSyncAt: 200,
      lastSuccessAt: null,
      lastErrorCode: 'CONNECTOR_FOLDER_UNAVAILABLE',
    });
  });

  it('disconnects without deleting files already imported into Inbox', async () => {
    writeFileSync(path.join(sourceDirectory, 'keep.txt'), 'keep');
    const connection = createConnection();
    await service.sync(connection.id, 200);

    service.disconnect(connection.id, 300);

    expect(service.list()).toEqual([]);
    expect(inbox.list({ view: 'pending' }).items).toHaveLength(1);
  });
});
