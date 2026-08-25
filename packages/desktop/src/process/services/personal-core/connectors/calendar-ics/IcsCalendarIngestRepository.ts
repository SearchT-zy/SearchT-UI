import { createHash } from 'node:crypto';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { IcsParsedEvent } from './icsParser';

export type IcsApplyResult = {
  imported: number;
  updated: number;
  removed: number;
  eventIds: string[];
};

export function icsEventId(uid: string): string {
  return `ics-${createHash('sha256').update(uid).digest('hex').slice(0, 16)}`;
}

/**
 * Read-only subscription projection: current feed contents are upserted into
 * `calendar_events`, and previously imported events that disappeared from the
 * feed are soft-deleted so trash restore keeps working.
 */
export class IcsCalendarIngestRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  applyEvents(events: IcsParsedEvent[], timezone: string, now: number): IcsApplyResult {
    const operation = this.driver.transaction(() => {
      const existing = this.driver
        .prepare("SELECT id, deleted_at FROM calendar_events WHERE id LIKE 'ics-%'")
        .all() as Array<{ id: string; deleted_at: number | null }>;
      const existingIds = new Set(existing.map((row) => row.id));
      const targetIds = new Set(events.map((event) => icsEventId(event.uid)));
      let imported = 0;
      let updated = 0;
      for (const event of events) {
        const id = icsEventId(event.uid);
        const insert = this.driver.prepare(`INSERT INTO calendar_events (
          id, title, description, location, all_day, starts_at, ends_at, start_local_date, end_local_date,
          timezone, series_id, occurrence_key, reminder_minutes, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
          location = excluded.location, all_day = excluded.all_day, starts_at = excluded.starts_at,
          ends_at = excluded.ends_at, start_local_date = excluded.start_local_date,
          end_local_date = excluded.end_local_date, timezone = excluded.timezone, updated_at = excluded.updated_at,
          deleted_at = NULL`);
        insert.run(
          id,
          event.summary,
          event.description,
          event.location,
          event.allDay ? 1 : 0,
          event.startsAt,
          event.endsAt,
          event.startLocalDate,
          event.endLocalDate,
          timezone,
          now,
          now
        );
        if (existingIds.has(id)) updated += 1;
        else imported += 1;
      }
      let removed = 0;
      const softDelete = this.driver.prepare(
        'UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      );
      for (const id of existingIds) {
        if (!targetIds.has(id)) {
          if (softDelete.run(now, now, id).changes > 0) removed += 1;
        }
      }
      return { imported, updated, removed, eventIds: [...targetIds] };
    });
    return operation();
  }

  removeAll(now: number): number {
    const result = this.driver
      .prepare("UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id LIKE 'ics-%' AND deleted_at IS NULL")
      .run(now, now);
    return result.changes;
  }
}
