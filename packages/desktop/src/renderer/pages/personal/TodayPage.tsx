import React, { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Empty, Message, Skeleton } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import PersonalPageShell from './PersonalPageShell';
import { taskClient } from './taskClient';
import { calendarClient } from './calendarClient';
import { inboxClient } from '../inbox/inboxClient';
import type { Task } from '@/common/types/searcht/tasks';
import type { TodaySchedule } from '@/common/types/searcht/calendar';
import type { InboxPendingSummary } from '@/common/types/searcht/inbox';

const localDate = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const TodayFocusBand: React.FC = () => {
  const { t } = useTranslation();
  const [focusItems, setFocusItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const date = localDate();
        const [todayTasks, schedule] = await Promise.all([
          taskClient.list({ view: 'today', todayLocalDate: date }),
          calendarClient.getToday(date).catch((): TodaySchedule => ({ events: [], blocks: [] })),
        ]);
        if (!active) return;
        const items: string[] = [];
        // Most overdue / today tasks first (up to 2)
        for (const task of todayTasks.slice(0, 2)) {
          items.push(task.title);
        }
        // Next event today
        const nextEvent = schedule.events[0];
        if (nextEvent) {
          items.push(`📅 ${nextEvent.title}`);
        }
        setFocusItems(items.slice(0, 3));
      } catch {
        // Leave empty on error; the dedicated bands below show retry buttons.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className='border-b border-border-2 py-18px first:pt-0 last:border-b-0'>
      <h2 className='mb-12px mt-0 text-14px font-600 leading-22px text-t-primary'>
        {t('personal.today.focus')}
      </h2>
      {loading ? (
        <Skeleton text={{ rows: 2, width: ['72%', '48%'] }} animation />
      ) : focusItems.length === 0 ? (
        <Empty className='py-16px' description={t('personal.today.focusEmpty', { defaultValue: '当前没有需要重点关注的内容' })} />
      ) : (
        <div className='flex flex-col gap-6px'>
          {focusItems.map((item, index) => (
            <div key={index} className='truncate text-13px text-t-primary'>
              {item}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const TodayTasksBand: React.FC = () => {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const date = localDate();
      const [today, all] = await Promise.all([
        taskClient.list({ view: 'today', todayLocalDate: date }),
        taskClient.list({ view: 'all', todayLocalDate: date }),
      ]);
      const overdue = all.filter((task) => task.status === 'open' && task.dueLocalDate && task.dueLocalDate < date);
      setTasks([...overdue, ...today].slice(0, 8));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const complete = async (task: Task) => {
    try {
      await taskClient.complete(task.id);
      await load();
    } catch {
      Message.error(t('personal.tasks.completeError'));
    }
  };
  return (
    <section className='border-b border-border-2 py-18px'>
      <div className='mb-12px flex items-center justify-between gap-8px'>
        <h2 className='m-0 text-14px font-600 leading-22px text-t-primary'>{t('personal.tasks.title')}</h2>
        <Link to='/tasks' className='text-12px text-t-secondary'>
          {t('personal.tasks.viewAll')}
        </Link>
      </div>
      {error ? (
        <div className='flex items-center gap-8px text-13px text-t-secondary'>
          <span>{t('personal.tasks.loadError')}</span>
          <Button type='text' size='small' onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : tasks.length === 0 ? (
        <Empty className='py-16px' description={t('personal.tasks.todayEmpty')} />
      ) : (
        <div className='flex flex-col gap-6px'>
          {tasks.map((task) => (
            <div key={task.id} className='flex items-center gap-8px py-4px'>
              <Checkbox onChange={() => void complete(task)} />
              <span className='truncate text-13px text-t-primary'>{task.title}</span>
              {task.dueLocalDate && task.dueLocalDate < localDate() ? (
                <span className='shrink-0 text-12px text-red-6'>{t('personal.tasks.overdue')}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const TodayScheduleBand: React.FC = () => {
  const { t } = useTranslation();
  const [schedule, setSchedule] = useState<TodaySchedule>({ events: [], blocks: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSchedule(await calendarClient.getToday(localDate()));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className='border-b border-border-2 py-18px'>
      <div className='mb-12px flex items-center justify-between gap-8px'>
        <h2 className='m-0 text-14px font-600 leading-22px text-t-primary'>{t('personal.calendar.title')}</h2>
        <Link to='/calendar' className='text-12px text-t-secondary'>
          {t('personal.tasks.viewAll')}
        </Link>
      </div>
      {loading ? (
        <Skeleton text={{ rows: 2 }} animation />
      ) : error ? (
        <Button type='text' size='small' onClick={() => void load()}>
          {t('common.retry')}
        </Button>
      ) : schedule.events.length === 0 && schedule.blocks.length === 0 ? (
        <Empty className='py-16px' description={t('personal.calendar.empty')} />
      ) : (
        <div className='flex flex-col gap-8px'>
          {schedule.events.map((event) => (
            <div key={event.id} className='truncate text-13px text-t-primary'>
              {event.title}
            </div>
          ))}
          {schedule.blocks.map((block) => (
            <div key={block.id} className='flex gap-8px text-13px text-t-secondary'>
              <span>{new Date(block.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className='truncate'>{block.taskId}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const TodayInboxBand: React.FC = () => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<InboxPendingSummary>({ count: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await inboxClient.getPendingSummary(3));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className='border-b border-border-2 py-18px last:border-b-0'>
      <div className='mb-12px flex items-center justify-between gap-8px'>
        <h2 className='m-0 text-14px font-600 leading-22px text-t-primary'>{t('personal.inbox.title')}</h2>
        <Link
          to='/inbox'
          aria-label={`${t('personal.tasks.viewAll')} ${t('personal.inbox.title')}`}
          className='text-12px text-t-secondary'
        >
          {t('personal.tasks.viewAll')}
        </Link>
      </div>
      {loading ? (
        <Skeleton text={{ rows: 2 }} animation />
      ) : error ? (
        <div className='flex items-center gap-8px text-13px text-t-secondary'>
          <span>{t('personal.inbox.errors.load')}</span>
          <Button type='text' size='small' onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : summary.count === 0 ? (
        <Empty className='py-16px' description={t('personal.inbox.empty')} />
      ) : (
        <div className='flex flex-col gap-6px'>
          <p className='m-0 text-12px text-t-secondary'>
            {t('personal.inbox.views.pending')}: {summary.count}
          </p>
          {summary.items.slice(0, 3).map((item) => (
            <Link key={item.id} to='/inbox' className='truncate py-4px text-13px text-t-primary no-underline'>
              {item.title}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
};

const TodayPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <PersonalPageShell title={t('personal.today.title')} description={t('personal.today.summary')}>
      <div className='grid grid-cols-1 gap-x-32px lg:grid-cols-2'>
        <TodayFocusBand />
        <TodayScheduleBand />
        <TodayTasksBand />
        <TodayInboxBand />
      </div>
    </PersonalPageShell>
  );
};

export default TodayPage;
