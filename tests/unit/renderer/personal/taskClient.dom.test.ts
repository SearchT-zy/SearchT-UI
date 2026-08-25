// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadBrowserClient() {
  vi.resetModules();
  delete (window as Window & { electronAPI?: unknown }).electronAPI;
  return (await import('@renderer/pages/personal/taskClient')).taskClient;
}

describe('browser task client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('validates task input before storing it', async () => {
    const client = await loadBrowserClient();
    await expect(client.create({ title: '   ' })).rejects.toThrow('Task title must not be empty');
    await expect(client.list({ view: 'all', todayLocalDate: '2026-08-13' })).resolves.toEqual([]);
  });

  it('backs up a corrupted browser document before recovering with empty data', async () => {
    localStorage.setItem('searcht.tasks.v1', '{broken json');
    const client = await loadBrowserClient();

    await expect(client.list({ view: 'all', todayLocalDate: '2026-08-13' })).resolves.toEqual([]);

    const backupKey = Object.keys(localStorage).find((key) => key.startsWith('searcht.tasks.v1.corrupt.'));
    expect(backupKey).toBeDefined();
    expect(localStorage.getItem(backupKey!)).toBe('{broken json');
    expect(localStorage.getItem('searcht.tasks.v1')).toBeNull();
  });

  it('sorts browser tasks by urgency and priority like the desktop repository', async () => {
    const client = await loadBrowserClient();
    await client.create({ title: 'No date', priority: 'high' });
    await client.create({ title: 'Future', dueLocalDate: '2026-08-15', priority: 'medium' });
    await client.create({ title: 'Today low', dueLocalDate: '2026-08-13', priority: 'low' });
    await client.create({ title: 'Overdue low', dueLocalDate: '2026-08-12', priority: 'low' });
    await client.create({ title: 'Overdue high', dueLocalDate: '2026-08-12', priority: 'high' });

    const tasks = await client.list({ view: 'all', todayLocalDate: '2026-08-13' });

    expect(tasks.map((task) => task.title)).toEqual(['Overdue high', 'Overdue low', 'Today low', 'Future', 'No date']);
  });

  it('creates the next recurring instance when the current one is completed', async () => {
    const client = await loadBrowserClient();
    const current = await client.create({
      title: 'Daily review',
      dueLocalDate: '2026-08-13',
      recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'count', occurrences: 2 } },
    });

    const completed = await client.complete(current.id);
    expect(completed.task.status).toBe('completed');
    expect(completed.nextTask).toEqual(
      expect.objectContaining({ title: 'Daily review', dueLocalDate: '2026-08-14', status: 'open' })
    );
    await expect(client.complete(current.id)).resolves.toEqual(
      expect.objectContaining({ nextTask: expect.objectContaining({ id: completed.nextTask?.id }) })
    );
  });

  it('splits a recurring series when updating this and future instances', async () => {
    const client = await loadBrowserClient();
    const first = await client.create({
      title: 'Review',
      dueLocalDate: '2026-08-13',
      recurrence: { rule: { frequency: 'daily', interval: 1 } },
    });
    const next = (await client.complete(first.id)).nextTask!;

    const updated = await client.update({ id: next.id, title: 'Deep review' }, 'this-and-future');
    expect(updated.seriesId).not.toBe(first.seriesId);
    expect(updated.title).toBe('Deep review');
    expect((await client.list({ view: 'completed' }))[0]?.title).toBe('Review');
  });

  it('turns a normal task into a recurring series when recurrence is added', async () => {
    const client = await loadBrowserClient();
    const task = await client.create({ title: 'Plan day', dueLocalDate: '2026-08-13' });

    const recurring = await client.update(
      {
        id: task.id,
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      'single'
    );

    expect(recurring.seriesId).not.toBeNull();
    expect(recurring.recurrence?.rule).toEqual({ frequency: 'daily', interval: 1 });
    expect((await client.complete(recurring.id)).nextTask?.dueLocalDate).toBe('2026-08-14');
  });

  it('stops recurrence from this instance forward when recurrence is removed', async () => {
    const client = await loadBrowserClient();
    const first = await client.create({
      title: 'Plan day',
      dueLocalDate: '2026-08-13',
      recurrence: { rule: { frequency: 'daily', interval: 1 } },
    });
    const current = (await client.complete(first.id)).nextTask!;

    const normal = await client.update({ id: current.id, recurrence: null }, 'this-and-future');

    expect(normal).toEqual(expect.objectContaining({ seriesId: null, occurrenceKey: null, recurrence: null }));
    expect((await client.complete(normal.id)).nextTask).toBeUndefined();
    expect((await client.list({ view: 'completed' })).map((task) => task.id)).toContain(first.id);
  });

  it('stops this and future instances without deleting completed history', async () => {
    const client = await loadBrowserClient();
    const first = await client.create({
      title: 'Journal',
      dueLocalDate: '2026-08-13',
      recurrence: { rule: { frequency: 'daily', interval: 1 } },
    });
    const next = (await client.complete(first.id)).nextTask!;

    await client.remove(next.id, 'this-and-future');
    expect((await client.list({ view: 'trash' })).map((task) => task.id)).toContain(next.id);
    expect((await client.list({ view: 'completed' })).map((task) => task.id)).toContain(first.id);
  });

  it('keeps a recurring series moving after deleting only one instance', async () => {
    const client = await loadBrowserClient();
    const current = await client.create({
      title: 'Stretch',
      dueLocalDate: '2026-08-13',
      recurrence: { rule: { frequency: 'daily', interval: 1 } },
    });

    await client.remove(current.id, 'single');

    expect((await client.list({ view: 'trash' })).map((task) => task.id)).toContain(current.id);
    await expect(client.list({ view: 'all' })).resolves.toEqual([
      expect.objectContaining({ dueLocalDate: '2026-08-14', status: 'open', seriesId: current.seriesId }),
    ]);
  });

  it('restores an instance from a stopped series as a normal task', async () => {
    const client = await loadBrowserClient();
    const first = await client.create({
      title: 'Journal',
      dueLocalDate: '2026-08-13',
      recurrence: { rule: { frequency: 'daily', interval: 1 } },
    });
    const next = (await client.complete(first.id)).nextTask!;

    await client.remove(next.id, 'this-and-future');
    const restored = await client.restore(next.id);

    expect(restored).toEqual(expect.objectContaining({ deletedAt: null, seriesId: null, occurrenceKey: null }));
    expect(restored.recurrence).toBeNull();
  });
});
