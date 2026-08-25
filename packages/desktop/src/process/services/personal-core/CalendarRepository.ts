import type {
  CalendarEvent,
  CalendarRangeQuery,
  CalendarSeries,
  Reminder,
  ScheduleBlock,
} from '@/common/types/searcht/calendar';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type EventRow = {
  id: string;
  title: string;
  description: string;
  location: string;
  all_day: number;
  starts_at: string | null;
  ends_at: string | null;
  start_local_date: string;
  end_local_date: string;
  timezone: string;
  series_id: string | null;
  occurrence_key: string | null;
  reminder_minutes: CalendarEvent['reminderMinutes'];
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type SeriesRow = {
  id: string;
  rule_json: string;
  end_json: string;
  timezone: string;
  starts_at: string;
  stopped_at: string | null;
  created_at: number;
  updated_at: number;
};

type BlockRow = {
  id: string;
  task_id: string;
  starts_at: string;
  ends_at: string;
  local_date: string;
  timezone: string;
  reminder_minutes: ScheduleBlock['reminderMinutes'];
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type ReminderRow = {
  id: string;
  owner_type: Reminder['ownerType'];
  owner_id: string;
  scheduled_at: number;
  status: Reminder['status'];
  attempts: number;
  claimed_at: number | null;
  delivered_at: number | null;
  cancelled_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export class CalendarRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  transaction<T>(operation: () => T): T {
    return this.driver.transaction(operation)();
  }

  insertEvent(event: CalendarEvent): CalendarEvent {
    this.driver
      .prepare(`INSERT INTO calendar_events (id, title, description, location, all_day, starts_at, ends_at, start_local_date, end_local_date, timezone, series_id, occurrence_key, reminder_minutes, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        event.id,
        event.title,
        event.description,
        event.location,
        event.allDay ? 1 : 0,
        event.startsAt,
        event.endsAt,
        event.startLocalDate,
        event.endLocalDate,
        event.timezone,
        event.seriesId,
        event.occurrenceKey,
        event.reminderMinutes,
        event.createdAt,
        event.updatedAt,
        event.deletedAt
      );
    return this.findEvent(event.id)!;
  }

  updateEvent(event: CalendarEvent): CalendarEvent {
    this.driver
      .prepare(
        `UPDATE calendar_events SET title = ?, description = ?, location = ?, all_day = ?, starts_at = ?, ends_at = ?, start_local_date = ?, end_local_date = ?, timezone = ?, series_id = ?, occurrence_key = ?, reminder_minutes = ?, updated_at = ?, deleted_at = ? WHERE id = ?`
      )
      .run(
        event.title,
        event.description,
        event.location,
        event.allDay ? 1 : 0,
        event.startsAt,
        event.endsAt,
        event.startLocalDate,
        event.endLocalDate,
        event.timezone,
        event.seriesId,
        event.occurrenceKey,
        event.reminderMinutes,
        event.updatedAt,
        event.deletedAt,
        event.id
      );
    return this.findEvent(event.id)!;
  }

  findEvent(id: string): CalendarEvent | null {
    const row = this.driver.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as EventRow | undefined;
    return row ? mapEvent(row) : null;
  }

  listEvents(query: CalendarRangeQuery): CalendarEvent[] {
    const deletionFilter = query.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
    return (
      this.driver
        .prepare(
          `SELECT * FROM calendar_events WHERE ${deletionFilter} AND start_local_date < ? AND end_local_date > ? ORDER BY all_day DESC, COALESCE(starts_at, start_local_date) ASC, created_at ASC`
        )
        .all(query.endLocalDate, query.startLocalDate) as EventRow[]
    ).map(mapEvent);
  }

  setEventDeletedAt(id: string, deletedAt: number | null): void {
    this.driver
      .prepare('UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(deletedAt, Date.now(), id);
  }

  destroyEvent(id: string): void {
    this.driver.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
  }

  emptyEventTrash(): number {
    return this.driver.prepare('DELETE FROM calendar_events WHERE deleted_at IS NOT NULL').run().changes;
  }

  insertSeries(series: CalendarSeries): CalendarSeries {
    this.driver
      .prepare(
        'INSERT INTO calendar_series (id, rule_json, end_json, timezone, starts_at, stopped_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        series.id,
        JSON.stringify(series.rule),
        JSON.stringify(series.end),
        series.timezone,
        series.startsAt,
        series.stoppedAt,
        series.createdAt,
        series.updatedAt
      );
    return this.findSeries(series.id)!;
  }

  findSeries(id: string): CalendarSeries | null {
    const row = this.driver.prepare('SELECT * FROM calendar_series WHERE id = ?').get(id) as SeriesRow | undefined;
    return row ? mapSeries(row) : null;
  }

  updateSeries(series: CalendarSeries): CalendarSeries {
    this.driver
      .prepare(
        'UPDATE calendar_series SET rule_json = ?, end_json = ?, timezone = ?, starts_at = ?, stopped_at = ?, updated_at = ? WHERE id = ?'
      )
      .run(
        JSON.stringify(series.rule),
        JSON.stringify(series.end),
        series.timezone,
        series.startsAt,
        series.stoppedAt,
        series.updatedAt,
        series.id
      );
    return this.findSeries(series.id)!;
  }

  findEventOccurrence(seriesId: string, occurrenceKey: string): CalendarEvent | null {
    const row = this.driver
      .prepare('SELECT * FROM calendar_events WHERE series_id = ? AND occurrence_key = ?')
      .get(seriesId, occurrenceKey) as EventRow | undefined;
    return row ? mapEvent(row) : null;
  }

  listSeriesEvents(seriesId: string): CalendarEvent[] {
    return (
      this.driver
        .prepare('SELECT * FROM calendar_events WHERE series_id = ? ORDER BY occurrence_key')
        .all(seriesId) as EventRow[]
    ).map(mapEvent);
  }

  insertBlock(block: ScheduleBlock): ScheduleBlock {
    this.driver
      .prepare(
        'INSERT INTO schedule_blocks (id, task_id, starts_at, ends_at, local_date, timezone, reminder_minutes, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        block.id,
        block.taskId,
        block.startsAt,
        block.endsAt,
        block.localDate,
        block.timezone,
        block.reminderMinutes,
        block.createdAt,
        block.updatedAt,
        block.deletedAt
      );
    return this.findBlock(block.id)!;
  }

  updateBlock(block: ScheduleBlock): ScheduleBlock {
    this.driver
      .prepare(
        'UPDATE schedule_blocks SET starts_at = ?, ends_at = ?, local_date = ?, timezone = ?, reminder_minutes = ?, updated_at = ?, deleted_at = ? WHERE id = ?'
      )
      .run(
        block.startsAt,
        block.endsAt,
        block.localDate,
        block.timezone,
        block.reminderMinutes,
        block.updatedAt,
        block.deletedAt,
        block.id
      );
    return this.findBlock(block.id)!;
  }

  findBlock(id: string): ScheduleBlock | null {
    const row = this.driver.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(id) as BlockRow | undefined;
    return row ? mapBlock(row) : null;
  }

  listBlocks(query: CalendarRangeQuery): ScheduleBlock[] {
    const deletionFilter = query.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
    return (
      this.driver
        .prepare(
          `SELECT * FROM schedule_blocks WHERE ${deletionFilter} AND local_date >= ? AND local_date < ? ORDER BY starts_at, created_at`
        )
        .all(query.startLocalDate, query.endLocalDate) as BlockRow[]
    ).map(mapBlock);
  }

  setBlockDeletedAt(id: string, deletedAt: number | null): void {
    this.driver
      .prepare('UPDATE schedule_blocks SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(deletedAt, Date.now(), id);
  }

  destroyBlock(id: string): void {
    this.driver.prepare('DELETE FROM schedule_blocks WHERE id = ?').run(id);
  }

  upsertReminder(reminder: Reminder): Reminder {
    this.driver
      .prepare(`INSERT INTO reminders (id, owner_type, owner_id, scheduled_at, status, attempts, claimed_at, delivered_at, cancelled_at, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_type, owner_id) DO UPDATE SET scheduled_at = excluded.scheduled_at, status = excluded.status, attempts = excluded.attempts, claimed_at = excluded.claimed_at, delivered_at = excluded.delivered_at, cancelled_at = excluded.cancelled_at, last_error = excluded.last_error, updated_at = excluded.updated_at`)
      .run(
        reminder.id,
        reminder.ownerType,
        reminder.ownerId,
        reminder.scheduledAt,
        reminder.status,
        reminder.attempts,
        reminder.claimedAt,
        reminder.deliveredAt,
        reminder.cancelledAt,
        reminder.lastError,
        reminder.createdAt,
        reminder.updatedAt
      );
    return this.findReminderByOwner(reminder.ownerType, reminder.ownerId)!;
  }

  findReminderByOwner(ownerType: Reminder['ownerType'], ownerId: string): Reminder | null {
    const row = this.driver
      .prepare('SELECT * FROM reminders WHERE owner_type = ? AND owner_id = ?')
      .get(ownerType, ownerId) as ReminderRow | undefined;
    return row ? mapReminder(row) : null;
  }

  claimDueReminders(now: number, missedAfter: number): Reminder[] {
    return this.transaction(() => {
      const rows = this.driver
        .prepare(
          "SELECT * FROM reminders WHERE status = 'pending' AND scheduled_at <= ? AND scheduled_at >= ? ORDER BY scheduled_at LIMIT 100"
        )
        .all(now, missedAfter) as ReminderRow[];
      if (rows.length === 0) return [];
      const statement = this.driver.prepare(
        "UPDATE reminders SET status = 'claimed', claimed_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'"
      );
      return rows
        .filter((row) => statement.run(now, now, row.id).changes === 1)
        .map((row) =>
          mapReminder({ ...row, status: 'claimed', claimed_at: now, attempts: row.attempts + 1, updated_at: now })
        );
    });
  }

  updateReminder(reminder: Reminder): Reminder {
    this.driver
      .prepare(
        'UPDATE reminders SET scheduled_at = ?, status = ?, attempts = ?, claimed_at = ?, delivered_at = ?, cancelled_at = ?, last_error = ?, updated_at = ? WHERE id = ?'
      )
      .run(
        reminder.scheduledAt,
        reminder.status,
        reminder.attempts,
        reminder.claimedAt,
        reminder.deliveredAt,
        reminder.cancelledAt,
        reminder.lastError,
        reminder.updatedAt,
        reminder.id
      );
    const row = this.driver.prepare('SELECT * FROM reminders WHERE id = ?').get(reminder.id) as ReminderRow;
    return mapReminder(row);
  }

  cancelReminder(ownerType: Reminder['ownerType'], ownerId: string, cancelledAt = Date.now()): void {
    this.driver
      .prepare(
        "UPDATE reminders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE owner_type = ? AND owner_id = ? AND status NOT IN ('delivered', 'cancelled')"
      )
      .run(cancelledAt, cancelledAt, ownerType, ownerId);
  }

  cancelExpiredReminders(before: number, now: number): number {
    return this.driver
      .prepare(
        "UPDATE reminders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE status = 'pending' AND scheduled_at < ?"
      )
      .run(now, now, before).changes;
  }

  insertAudit(id: string, action: string, detail: Record<string, unknown>, createdAt: number): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, action, 'success', JSON.stringify(detail), createdAt);
  }
}

function mapEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    allDay: row.all_day === 1,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startLocalDate: row.start_local_date,
    endLocalDate: row.end_local_date,
    timezone: row.timezone,
    seriesId: row.series_id,
    occurrenceKey: row.occurrence_key,
    reminderMinutes: row.reminder_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapSeries(row: SeriesRow): CalendarSeries {
  return {
    id: row.id,
    rule: JSON.parse(row.rule_json),
    end: JSON.parse(row.end_json),
    timezone: row.timezone,
    startsAt: row.starts_at,
    stoppedAt: row.stopped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBlock(row: BlockRow): ScheduleBlock {
  return {
    id: row.id,
    taskId: row.task_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    localDate: row.local_date,
    timezone: row.timezone,
    reminderMinutes: row.reminder_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    attempts: row.attempts,
    claimedAt: row.claimed_at,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
