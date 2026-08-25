export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ['open', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_LIST_VIEWS = ['all', 'today', 'scheduled', 'completed', 'trash'] as const;
export type TaskListView = (typeof TASK_LIST_VIEWS)[number];

export type TaskRecurrenceRule =
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekdays'; interval: 1 }
  | { frequency: 'weekly'; interval: number; weekdays: number[] }
  | { frequency: 'monthly'; interval: number; dayOfMonth: number };

export type TaskRecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'until'; date: string }
  | { kind: 'count'; occurrences: number };

export type Task = {
  id: string;
  title: string;
  notes: string;
  priority: TaskPriority;
  dueAt: string | null;
  dueLocalDate: string | null;
  estimatedMinutes: number | null;
  status: TaskStatus;
  completedAt: number | null;
  seriesId: string | null;
  occurrenceKey: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  recurrence?: { rule: TaskRecurrenceRule; end: TaskRecurrenceEnd; timezone: string } | null;
};

export type TaskSeries = {
  id: string;
  rule: TaskRecurrenceRule;
  end: TaskRecurrenceEnd;
  timezone: string;
  startsAt: string;
  stoppedAt: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TaskCreateInput = {
  title: string;
  notes?: string;
  priority?: TaskPriority;
  dueAt?: string | null;
  dueLocalDate?: string | null;
  estimatedMinutes?: number | null;
  recurrence?: { rule: TaskRecurrenceRule; end?: TaskRecurrenceEnd; timezone?: string };
};

export type TaskUpdateInput = Partial<Omit<TaskCreateInput, 'recurrence'>> & {
  id: string;
  recurrence?: { rule: TaskRecurrenceRule; end?: TaskRecurrenceEnd; timezone?: string } | null;
};

export type TaskListQuery = {
  view: TaskListView;
  todayLocalDate?: string;
};

export type TaskScope = 'single' | 'this-and-future';
