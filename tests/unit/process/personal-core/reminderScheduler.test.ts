import { describe, expect, it, vi } from 'vitest';
import type { Reminder } from '@/common/types/searcht/calendar';
import { ReminderScheduler } from '@process/services/personal-core/ReminderScheduler';

const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: 'r1',
  ownerType: 'event',
  ownerId: 'e1',
  scheduledAt: 100,
  status: 'claimed',
  attempts: 1,
  claimedAt: 200,
  deliveredAt: null,
  cancelledAt: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('ReminderScheduler', () => {
  it('delivers claimed reminders and marks them once', async () => {
    const repository = {
      claimDueReminders: vi.fn(() => [reminder()]),
      updateReminder: vi.fn((value) => value),
      cancelExpiredReminders: vi.fn(),
    };
    const notify = vi.fn(async () => undefined);
    const scheduler = new ReminderScheduler(repository, notify, () => 200);
    await scheduler.poll();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(repository.updateReminder).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered', deliveredAt: 200 })
    );
  });

  it('retries failures up to three attempts then marks failed', async () => {
    const repository = {
      claimDueReminders: vi.fn(() => [reminder({ attempts: 3 })]),
      updateReminder: vi.fn((value) => value),
      cancelExpiredReminders: vi.fn(),
    };
    const scheduler = new ReminderScheduler(
      repository,
      vi.fn(async () => {
        throw new Error('blocked');
      }),
      () => 200
    );
    await scheduler.poll();
    expect(repository.updateReminder).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', attempts: 3, lastError: 'blocked' })
    );
  });

  it('claims only reminders from the last 24 hours', async () => {
    const repository = { claimDueReminders: vi.fn(() => []), updateReminder: vi.fn(), cancelExpiredReminders: vi.fn() };
    const scheduler = new ReminderScheduler(repository, vi.fn(), () => 172_800_000);
    await scheduler.poll();
    expect(repository.cancelExpiredReminders).toHaveBeenCalledWith(86_400_000, 172_800_000);
    expect(repository.claimDueReminders).toHaveBeenCalledWith(172_800_000, 86_400_000);
  });
});
