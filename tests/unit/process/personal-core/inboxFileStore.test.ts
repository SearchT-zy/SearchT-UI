import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-inbox-files-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('InboxFileStore', () => {
  it('streams a regular file into its content-addressed managed path', async () => {
    const source = path.join(directory, 'source.txt');
    writeFileSync(source, 'hello');
    const store = new InboxFileStore(path.join(directory, 'managed'));

    const result = await store.importFile(source);

    expect(result.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(result).toMatchObject({ sizeBytes: 5, mimeType: 'text/plain', createdNewFile: true });
    expect(existsSync(store.resolveManagedPath(result.managedName))).toBe(true);
  });

  it('reuses one managed file for identical content and leaves no temporary files', async () => {
    const first = path.join(directory, 'one.txt');
    const second = path.join(directory, 'two.txt');
    writeFileSync(first, 'same');
    writeFileSync(second, 'same');
    const store = new InboxFileStore(path.join(directory, 'managed'));

    const created = await store.importFile(first);
    const reused = await store.importFile(second);

    expect(reused).toMatchObject({ sha256: created.sha256, managedName: created.managedName, createdNewFile: false });
    expect(readdirSync(path.join(directory, 'managed', '.tmp'))).toEqual([]);
  });

  it('rejects files over the configured limit without leaving a partial copy', async () => {
    const source = path.join(directory, 'large.bin');
    writeFileSync(source, 'four');
    const store = new InboxFileStore(path.join(directory, 'managed'), { maxFileBytes: 3 });

    await expect(store.importFile(source)).rejects.toThrow('INBOX_FILE_TOO_LARGE');
    expect(readdirSync(path.join(directory, 'managed', '.tmp'))).toEqual([]);
  });

  it('rejects an aborted import and removes its temporary copy', async () => {
    const source = path.join(directory, 'source.txt');
    writeFileSync(source, 'hello');
    const store = new InboxFileStore(path.join(directory, 'managed'));
    const controller = new AbortController();
    controller.abort();

    await expect(store.importFile(source, controller.signal)).rejects.toThrow('INBOX_IMPORT_CANCELLED');
    expect(readdirSync(path.join(directory, 'managed', '.tmp'))).toEqual([]);
  });

  it('rejects symbolic links instead of traversing them', async () => {
    const source = path.join(directory, 'source.txt');
    const link = path.join(directory, 'link.txt');
    writeFileSync(source, 'hello');
    symlinkSync(source, link, 'file');
    const store = new InboxFileStore(path.join(directory, 'managed'));

    await expect(store.importFile(link)).rejects.toThrow('INBOX_FILE_NOT_REGULAR');
  });

  it('rejects managed names that could escape the managed root', () => {
    const store = new InboxFileStore(path.join(directory, 'managed'));

    expect(() => store.resolveManagedPath('..\\secret')).toThrow('INBOX_MANAGED_NAME_INVALID');
    expect(() => store.resolveManagedPath('../secret')).toThrow('INBOX_MANAGED_NAME_INVALID');
  });

  it('returns browser-safe image and bounded text preview descriptors', async () => {
    const imageSource = path.join(directory, 'photo.png');
    const textSource = path.join(directory, 'notes.md');
    writeFileSync(imageSource, 'image');
    writeFileSync(textSource, '# Notes and more');
    const store = new InboxFileStore(path.join(directory, 'managed'), { textPreviewBytes: 7 });
    const image = await store.importFile(imageSource);
    const text = await store.importFile(textSource);

    expect(store.getPreview(image.managedName, image.mimeType, 'photo.png')).toMatchObject({
      kind: 'image',
      displayName: 'photo.png',
      url: 'data:image/png;base64,aW1hZ2U=',
      canReveal: true,
      canDownload: false,
    });
    expect(store.getPreview(text.managedName, text.mimeType, 'notes.md')).toMatchObject({
      kind: 'text',
      text: '# Notes',
      truncated: true,
      canReveal: true,
    });
  });

  it('describes documents and reports missing managed files without exposing paths', async () => {
    const source = path.join(directory, 'brief.pdf');
    writeFileSync(source, 'pdf');
    const store = new InboxFileStore(path.join(directory, 'managed'));
    const imported = await store.importFile(source);

    expect(store.getPreview(imported.managedName, imported.mimeType, 'brief.pdf')).toMatchObject({
      kind: 'document',
      displayName: 'brief.pdf',
      url: null,
      canReveal: true,
    });
    store.removeManagedFile(imported.managedName);
    expect(store.getPreview(imported.managedName, imported.mimeType, 'brief.pdf')).toEqual({
      kind: 'missing',
      mimeType: imported.mimeType,
      displayName: 'brief.pdf',
      url: null,
      text: null,
      truncated: false,
      canReveal: false,
      canDownload: false,
    });
  });
});
