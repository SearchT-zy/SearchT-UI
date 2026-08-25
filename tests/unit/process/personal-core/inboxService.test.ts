import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';
import { InboxRepository } from '@process/services/personal-core/InboxRepository';
import { InboxService } from '@process/services/personal-core/InboxService';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';

let directory: string;
let database: PersonalDatabase;
let service: InboxService;
let repository: InboxRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-inbox-service-'));
  database = PersonalDatabase.open(directory);
  repository = new InboxRepository(database.driver);
  service = new InboxService(database.driver, new InboxFileStore(path.join(directory, 'personal-core', 'inbox')));
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('InboxService', () => {
  it('captures normalized text and links without sensitive audit details', () => {
    const text = service.captureText({ text: '  private body  ' }, 10);
    const link = service.captureLink({ url: 'https://secret.example/path' }, 11);

    expect(text).toMatchObject({ kind: 'text', title: 'private body', textContent: 'private body' });
    expect(link).toMatchObject({ kind: 'link', title: 'secret.example', url: 'https://secret.example/path' });
    const audit = database.driver
      .prepare('SELECT detail_json FROM personal_audit_log ORDER BY created_at')
      .all() as Array<{
      detail_json: string;
    }>;
    expect(audit).toHaveLength(2);
    expect(audit.map((row) => row.detail_json).join(' ')).not.toContain('private body');
    expect(audit.map((row) => row.detail_json).join(' ')).not.toContain('secret.example');
  });

  it('imports identical files once while preserving separate origins', async () => {
    const first = path.join(directory, 'private-one.txt');
    const second = path.join(directory, 'private-two.txt');
    writeFileSync(first, 'same');
    writeFileSync(second, 'same');

    const result = await service.importFiles({
      files: [
        { kind: 'path', name: 'private-one.txt', sizeBytes: 4, path: first },
        { kind: 'path', name: 'private-two.txt', sizeBytes: 4, path: second },
      ],
    });

    expect(result.imported.map((value) => value.outcome)).toEqual(['created', 'reused']);
    expect(result.imported[0]?.detail.asset?.id).toBe(result.imported[1]?.detail.asset?.id);
    expect(result.imported[0]?.detail.origin?.id).not.toBe(result.imported[1]?.detail.origin?.id);
    expect(result.failed).toEqual([]);
  });

  it('returns a safe preview descriptor while keeping the managed path internal', async () => {
    const source = path.join(directory, 'preview.md');
    writeFileSync(source, '# Preview');
    const imported = await service.importFiles({
      files: [{ kind: 'path', name: 'preview.md', sizeBytes: 9, path: source }],
    });
    const id = imported.imported[0]!.detail.item.id;

    const preview = service.getPreview(id);

    expect(preview).toMatchObject({ kind: 'text', displayName: 'preview.md', text: '# Preview', canReveal: true });
    expect(JSON.stringify(preview)).not.toContain(directory);
    expect(service.getManagedFilePath(id)).toContain(imported.imported[0]!.detail.asset!.managedName);
  });

  it('converts to a task transactionally and returns the same target on retry', () => {
    const source = service.captureText({ text: 'Turn this into work' }, 20);
    const input = {
      sourceId: source.id,
      operationId: 'operation-1',
      target: { title: 'Do work', notes: 'From Inbox' },
    };

    const created = service.convertToTask(input, 21);
    const retried = service.convertToTask(input, 22);

    expect(created.alreadyCompleted).toBe(false);
    expect(retried).toMatchObject({ targetId: created.targetId, alreadyCompleted: true });
    expect(repository.getDetail(source.id)?.item.state).toBe('organized');
    expect(database.driver.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 1 });
    expect(repository.getDetail(source.id)?.sourceLinks).toHaveLength(1);
  });

  it('converts to an ordinary non-recurring calendar event', () => {
    const source = service.captureLink({ url: 'https://example.com' }, 30);

    const result = service.convertToEvent(
      {
        sourceId: source.id,
        operationId: 'operation-event',
        target: {
          title: 'Review link',
          allDay: true,
          startLocalDate: '2026-08-14',
          endLocalDate: '2026-08-15',
          timezone: 'Asia/Shanghai',
        },
      },
      31
    );

    expect(result.alreadyCompleted).toBe(false);
    expect(
      database.driver.prepare('SELECT id, series_id FROM calendar_events WHERE id = ?').get(result.targetId)
    ).toEqual({
      id: result.targetId,
      series_id: null,
    });
  });

  it('converts text to a revisioned note with provenance and is idempotent', () => {
    const source = service.captureText({ title: 'Research note', text: 'Evidence from the inbox' }, 32);
    const input = { sourceId: source.id, operationId: 'operation-note' };

    const created = service.convertToNote(input, 33);
    const retried = service.convertToNote(input, 34);

    expect(created.alreadyCompleted).toBe(false);
    expect(retried).toMatchObject({ targetId: created.targetId, alreadyCompleted: true });
    expect(
      database.driver.prepare('SELECT title, body, revision_number FROM notes WHERE id = ?').get(created.targetId)
    ).toEqual({ title: 'Research note', body: 'Evidence from the inbox', revision_number: 1 });
    expect(
      database.driver.prepare('SELECT COUNT(*) AS count FROM note_revisions WHERE note_id = ?').get(created.targetId)
    ).toEqual({
      count: 1,
    });
    expect(repository.getDetail(source.id)?.sourceLinks).toEqual([
      expect.objectContaining({ targetType: 'note', targetId: created.targetId }),
    ]);
    expect(repository.getDetail(source.id)?.item.state).toBe('organized');
  });

  it('adds text and links to Knowledge with source provenance and idempotent retry', () => {
    const source = service.captureLink({ title: 'Reference', url: 'https://example.com/guide' }, 35);
    const input = { sourceId: source.id, operationId: 'operation-knowledge' };

    const created = service.convertToKnowledge(input, 36);
    const retried = service.convertToKnowledge(input, 37);

    expect(created.alreadyCompleted).toBe(false);
    expect(retried).toMatchObject({ targetId: created.targetId, alreadyCompleted: true });
    expect(
      database.driver.prepare('SELECT source_type, source_id, title, content_text FROM knowledge_sources').get()
    ).toEqual({
      source_type: 'inbox-item',
      source_id: source.id,
      title: 'Reference',
      content_text: 'https://example.com/guide',
    });
    expect(repository.getDetail(source.id)?.sourceLinks).toEqual([
      expect.objectContaining({ targetType: 'knowledge-source', targetId: created.targetId }),
    ]);
  });

  it('indexes supported managed-file preview text without exposing its path', async () => {
    const sourcePath = path.join(directory, 'knowledge.md');
    writeFileSync(sourcePath, '# Local knowledge');
    const imported = await service.importFiles({
      files: [{ kind: 'path', name: 'knowledge.md', sizeBytes: 17, path: sourcePath }],
    });
    const sourceId = imported.imported[0]!.detail.item.id;

    const result = service.convertToKnowledge({ sourceId, operationId: 'operation-file-knowledge' }, 38);
    const stored = database.driver
      .prepare('SELECT content_text FROM knowledge_sources WHERE id = ?')
      .get(result.targetId);

    expect(stored).toEqual({ content_text: '# Local knowledge' });
    expect(JSON.stringify(stored)).not.toContain(directory);
  });

  it('rolls back unsupported-file Knowledge conversion and leaves the Inbox item pending', async () => {
    const sourcePath = path.join(directory, 'opaque.bin');
    writeFileSync(sourcePath, Buffer.from([0, 1, 2, 3]));
    const imported = await service.importFiles({
      files: [{ kind: 'path', name: 'opaque.bin', sizeBytes: 4, path: sourcePath }],
    });
    const sourceId = imported.imported[0]!.detail.item.id;

    expect(() => service.convertToKnowledge({ sourceId, operationId: 'operation-opaque' }, 39)).toThrow(
      'KNOWLEDGE_CONTENT_UNAVAILABLE'
    );
    expect(repository.getDetail(sourceId)?.item.state).toBe('pending');
    expect(repository.getDetail(sourceId)?.sourceLinks).toEqual([]);
    expect(database.driver.prepare('SELECT COUNT(*) AS count FROM knowledge_sources').get()).toEqual({ count: 0 });
  });

  it('archives, restores, and permanently deletes captures with their final managed file', async () => {
    const sourcePath = path.join(directory, 'delete-me.txt');
    writeFileSync(sourcePath, 'remove');
    const imported = await service.importFiles({
      files: [{ kind: 'path', name: 'delete-me.txt', sizeBytes: 6, path: sourcePath }],
    });
    const id = imported.imported[0]!.detail.item.id;
    const managedName = imported.imported[0]!.detail.asset!.managedName;

    service.archive([id], 40);
    service.remove([id], 41);
    expect(service.list({ view: 'trash' }).items.map((value) => value.id)).toEqual([id]);
    service.restore([id], 42);
    service.remove([id], 43);
    service.destroy([id], 44);

    expect(service.get(id)).toBeNull();
    expect(repository.findAssetBySha256(managedName)).toBeNull();
  });

  it('empties more than the public batch limit in internal chunks', () => {
    const insert = database.driver.prepare(`INSERT INTO inbox_items (
      id, kind, state, title, text_content, url, origin_id, captured_at,
      organized_at, archived_at, created_at, updated_at, deleted_at
    ) VALUES (?, 'text', 'pending', 'Trash', 'Body', NULL, NULL, ?, NULL, NULL, ?, ?, ?)`);
    for (let index = 0; index < 501; index += 1) insert.run(`trash-${index}`, index, index, index, index + 1);

    expect(service.emptyTrash(1000).affectedCount).toBe(501);
    expect(service.list({ view: 'trash' }).total).toBe(0);
  });
});
