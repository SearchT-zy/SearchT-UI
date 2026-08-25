import type { PersonalModuleId } from '@/common/types/searcht/workspace';

export const PERSONAL_ROUTES = [
  { id: 'today', path: '/today', titleKey: 'personal.today.title' },
  { id: 'inbox', path: '/inbox', titleKey: 'personal.inbox.title' },
  { id: 'calendar', path: '/calendar', titleKey: 'personal.calendar.title' },
  { id: 'tasks', path: '/tasks', titleKey: 'personal.tasks.title' },
  { id: 'notes', path: '/notes', titleKey: 'personal.notes.title' },
  { id: 'knowledge', path: '/knowledge', titleKey: 'personal.knowledge.title' },
  { id: 'workflows', path: '/workflows', titleKey: 'personal.workflows.title' },
] as const satisfies ReadonlyArray<{ id: PersonalModuleId; path: string; titleKey: string }>;

export { default as ModulePage } from './ModulePage';
export { default as PersonalStartRedirect } from './PersonalStartRedirect';
export { default as TodayPage } from './TodayPage';
