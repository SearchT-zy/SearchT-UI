// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboxItem } from '@/common/types/searcht/inbox';
import { conversionTargetId } from '@/common/searcht/inboxValidation';

const browserDatabaseName = 'searcht-personal-core';

function deleteBrowserDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(browserDatabaseName);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

describe('inbox platform client', () => {
  beforeAll(async () => {
    await deleteBrowserDatabase();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
    localStorage.clear();
  });

  it('uses IndexedDB in the browser', async () => {
    const { inboxClient } = await import('@renderer/pages/inbox/inboxClient');

    const captured = await inboxClient.captureText({ text: 'Browser capture' });

    await expect(inboxClient.list({ view: 'pending' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: captured.id })], total: 1 })
    );
  });

  it('converts browser inbox items into deterministic task and calendar documents', async () => {
    const { inboxClient } = await import('@renderer/pages/inbox/inboxClient');
    const { taskClient } = await import('@renderer/pages/personal/taskClient');
    const { calendarClient } = await import('@renderer/pages/personal/calendarClient');
    const taskSource = await inboxClient.captureText({ text: 'Prepare launch notes' });
    const eventSource = await inboxClient.captureText({ text: 'Schedule launch review' });

    await inboxClient.convertToTask({
      sourceId: taskSource.id,
      operationId: 'browser-task-operation',
      target: { title: 'Prepare launch notes' },
    });
    await inboxClient.convertToEvent({
      sourceId: eventSource.id,
      operationId: 'browser-event-operation',
      target: {
        title: 'Launch review',
        allDay: true,
        startLocalDate: '2026-08-15',
        endLocalDate: '2026-08-16',
        timezone: 'Asia/Shanghai',
      },
    });

    await expect(taskClient.list({ view: 'all' })).resolves.toEqual([
      expect.objectContaining({ id: conversionTargetId('browser-task-operation', 'task') }),
    ]);
    await expect(calendarClient.get(conversionTargetId('browser-event-operation', 'calendar-event'))).resolves.toEqual(
      expect.objectContaining({ title: 'Launch review' })
    );
  });

  it('delegates to typed IPC on Electron desktop', async () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {};
    const { ipcBridge } = await import('@/common');
    const expected: InboxItem = {
      id: 'desktop-item',
      kind: 'text',
      state: 'pending',
      title: 'Desktop capture',
      textContent: 'Desktop capture',
      url: null,
      originId: null,
      capturedAt: 1,
      organizedAt: null,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    const invoke = vi.spyOn(ipcBridge.inbox.captureText, 'invoke').mockResolvedValue(expected);
    const preview = vi.spyOn(ipcBridge.inbox.getPreview, 'invoke').mockResolvedValue({
      kind: 'missing',
      mimeType: null,
      displayName: 'missing.txt',
      url: null,
      text: null,
      truncated: false,
      canReveal: false,
      canDownload: false,
    });
    const reveal = vi.spyOn(ipcBridge.inbox.revealManagedFile, 'invoke').mockResolvedValue(undefined);
    const { inboxClient } = await import('@renderer/pages/inbox/inboxClient');

    await expect(inboxClient.captureText({ text: 'Desktop capture' })).resolves.toEqual(expected);
    await expect(inboxClient.getPreview('desktop-item')).resolves.toMatchObject({ kind: 'missing' });
    await inboxClient.revealManagedFile('desktop-item');
    expect(invoke).toHaveBeenCalledWith({ text: 'Desktop capture' });
    expect(preview).toHaveBeenCalledWith({ id: 'desktop-item' });
    expect(reveal).toHaveBeenCalledWith({ id: 'desktop-item' });
  });
});
