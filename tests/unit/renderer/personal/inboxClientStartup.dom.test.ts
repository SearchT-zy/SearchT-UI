// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';

import { conversionTargetId } from '@/common/searcht/inboxValidation';
import { INBOX_DATABASE_NAME, openInboxDatabase } from '@renderer/pages/inbox/inboxDb';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(INBOX_DATABASE_NAME);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  delete (window as Window & { electronAPI?: unknown }).electronAPI;
  await deleteDatabase();
});

it('reconciles prepared WebUI conversions when the inbox client starts', async () => {
  const database = await openInboxDatabase();
  const item = await database.captureText({ text: 'Resume on startup' });
  await database.prepareConversion({
    sourceId: item.id,
    operationId: 'startup-operation',
    targetType: 'task',
    target: { title: 'Recovered task' },
  });
  database.close();

  await import('@renderer/pages/inbox/inboxClient');
  const { taskClient } = await import('@renderer/pages/personal/taskClient');

  await vi.waitFor(async () => {
    await expect(taskClient.list({ view: 'all' })).resolves.toEqual([
      expect.objectContaining({ id: conversionTargetId('startup-operation', 'task') }),
    ]);
  });
});
