import type { Task, TaskListQuery, TaskSeries } from '@/common/types/searcht/tasks';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type TaskRow = {
  id: string;
  title: string;
  notes: string;
  priority: Task['priority'];
  due_at: string | null;
  due_local_date: string | null;
  estimated_minutes: number | null;
  status: Task['status'];
  completed_at: number | null;
  series_id: string | null;
  occurrence_key: string | null;
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

export class TaskRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  insertTask(task: Task): Task {
    this.driver
      .prepare(`INSERT INTO tasks (id, title, notes, priority, due_at, due_local_date, estimated_minutes, status, completed_at, series_id, occurrence_key, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        task.id,
        task.title,
        task.notes,
        task.priority,
        task.dueAt,
        task.dueLocalDate,
        task.estimatedMinutes,
        task.status,
        task.completedAt,
        task.seriesId,
        task.occurrenceKey,
        task.createdAt,
        task.updatedAt,
        task.deletedAt
      );
    return this.findById(task.id)!;
  }

  updateTask(task: Task): Task {
    this.driver
      .prepare(
        `UPDATE tasks SET title = ?, notes = ?, priority = ?, due_at = ?, due_local_date = ?, estimated_minutes = ?, status = ?, completed_at = ?, series_id = ?, occurrence_key = ?, updated_at = ?, deleted_at = ? WHERE id = ?`
      )
      .run(
        task.title,
        task.notes,
        task.priority,
        task.dueAt,
        task.dueLocalDate,
        task.estimatedMinutes,
        task.status,
        task.completedAt,
        task.seriesId,
        task.occurrenceKey,
        task.updatedAt,
        task.deletedAt,
        task.id
      );
    return this.findById(task.id)!;
  }

  findById(id: string): Task | null {
    const row = this.driver.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  list(query: TaskListQuery): Task[] {
    const includeTrash = query.view === 'trash';
    let sql = 'SELECT * FROM tasks WHERE ';
    const params: unknown[] = [];
    if (includeTrash) sql += 'deleted_at IS NOT NULL';
    else sql += 'deleted_at IS NULL';
    if (query.view === 'today') {
      sql += ' AND due_local_date = ? AND status = ?';
      params.push(query.todayLocalDate, 'open');
    } else if (query.view === 'scheduled') {
      sql += ' AND due_local_date IS NOT NULL AND status = ?';
      params.push('open');
    } else if (query.view === 'completed') {
      sql += ' AND status = ?';
      params.push('completed');
    }
    sql +=
      " ORDER BY CASE WHEN status = 'open' AND due_local_date < ? THEN 0 WHEN status = 'open' AND due_local_date = ? THEN 1 WHEN status = 'open' AND due_local_date IS NOT NULL THEN 2 WHEN status = 'open' THEN 3 ELSE 4 END, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, COALESCE(due_local_date, '9999-12-31'), updated_at DESC";
    params.push(query.todayLocalDate ?? '9999-12-31', query.todayLocalDate ?? '9999-12-31');
    return (this.driver.prepare(sql).all(...params) as TaskRow[]).map(mapTask);
  }

  setDeletedAt(id: string, deletedAt: number | null): void {
    this.driver.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(deletedAt, Date.now(), id);
  }

  purgeTask(id: string): void {
    this.driver.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  insertSeries(series: TaskSeries): TaskSeries {
    this.driver
      .prepare(
        'INSERT INTO task_series (id, rule_json, end_json, timezone, starts_at, stopped_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
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
    return this.findSeriesById(series.id)!;
  }

  findSeriesById(id: string): TaskSeries | null {
    const row = this.driver.prepare('SELECT * FROM task_series WHERE id = ?').get(id) as SeriesRow | undefined;
    return row ? mapSeries(row) : null;
  }

  updateSeries(series: TaskSeries): TaskSeries {
    this.driver
      .prepare(
        'UPDATE task_series SET rule_json = ?, end_json = ?, timezone = ?, starts_at = ?, stopped_at = ?, updated_at = ? WHERE id = ?'
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
    return this.findSeriesById(series.id)!;
  }

  countSeriesOccurrences(seriesId: string): number {
    return (
      this.driver.prepare('SELECT COUNT(*) AS count FROM tasks WHERE series_id = ?').get(seriesId) as { count: number }
    ).count;
  }

  findByOccurrence(seriesId: string, occurrenceKey: string): Task | null {
    const row = this.driver
      .prepare('SELECT * FROM tasks WHERE series_id = ? AND occurrence_key = ?')
      .get(seriesId, occurrenceKey) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  listSeriesTasks(seriesId: string): Task[] {
    return (
      this.driver
        .prepare('SELECT * FROM tasks WHERE series_id = ? ORDER BY occurrence_key ASC, created_at ASC')
        .all(seriesId) as TaskRow[]
    ).map(mapTask);
  }

  deleteSeries(seriesId: string): void {
    this.driver.prepare('DELETE FROM task_series WHERE id = ?').run(seriesId);
  }

  deleteTasksBySeries(seriesId: string): number {
    return this.driver.prepare('DELETE FROM tasks WHERE series_id = ?').run(seriesId).changes;
  }

  setSeriesId(taskId: string, seriesId: string | null, occurrenceKey: string | null, updatedAt = Date.now()): void {
    this.driver
      .prepare('UPDATE tasks SET series_id = ?, occurrence_key = ?, updated_at = ? WHERE id = ?')
      .run(seriesId, occurrenceKey, updatedAt, taskId);
  }

  insertAudit(id: string, action: string, detail: Record<string, unknown>, createdAt: number): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, action, 'success', JSON.stringify(detail), createdAt);
  }
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    dueAt: row.due_at,
    dueLocalDate: row.due_local_date,
    estimatedMinutes: row.estimated_minutes,
    status: row.status,
    completedAt: row.completed_at,
    seriesId: row.series_id,
    occurrenceKey: row.occurrence_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapSeries(row: SeriesRow): TaskSeries {
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
