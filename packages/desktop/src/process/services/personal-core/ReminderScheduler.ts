import type { Reminder } from '@/common/types/searcht/calendar';

type ReminderRepository = {
  claimDueReminders(now: number, missedAfter: number): Reminder[];
  updateReminder(reminder: Reminder): Reminder;
  cancelExpiredReminders(before: number, now: number): number;
};

const MISSED_WINDOW_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 30_000;

export class ReminderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly repository: ReminderRepository,
    private readonly notify: (reminder: Reminder) => Promise<void>,
    private readonly now: () => number = Date.now
  ) {}

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = this.now();
      const missedAfter = now - MISSED_WINDOW_MS;
      this.repository.cancelExpiredReminders(missedAfter, now);
      for (const reminder of this.repository.claimDueReminders(now, missedAfter)) {
        try {
          // Deliver serially so each notification result is persisted before claiming the next one.
          // eslint-disable-next-line no-await-in-loop
          await this.notify(reminder);
          this.repository.updateReminder({
            ...reminder,
            status: 'delivered',
            deliveredAt: now,
            updatedAt: now,
            lastError: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.repository.updateReminder({
            ...reminder,
            status: reminder.attempts >= 3 ? 'failed' : 'pending',
            claimedAt: null,
            scheduledAt: reminder.attempts >= 3 ? reminder.scheduledAt : now + POLL_INTERVAL_MS,
            lastError: message,
            updatedAt: now,
          });
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
