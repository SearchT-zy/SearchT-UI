import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Message, Spin, Tabs } from '@arco-design/web-react';
import { Add, Left, Right, Time } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type {
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  CalendarScope,
  ScheduleBlock,
} from '@/common/types/searcht/calendar';
import PersonalPageShell from '../personal/PersonalPageShell';
import { calendarClient, type CalendarClient } from '../personal/calendarClient';
import CalendarDayList from './CalendarDayList';
import CalendarEditorDrawer from './CalendarEditorDrawer';
import CalendarMonth from './CalendarMonth';
import CalendarScopeModal from './CalendarScopeModal';
import ScheduleBlockDrawer from './ScheduleBlockDrawer';
import { monthRange, shiftMonth } from './calendarViewModel';

const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

type PendingScope = {
  event: CalendarEvent;
  action: 'edit' | 'remove';
  input?: CalendarEventUpdateInput;
};

const CalendarPage: React.FC<{ client?: CalendarClient; initialDate?: string }> = ({
  client = calendarClient,
  initialDate = localDate(),
}) => {
  const { t } = useTranslation();
  const [month, setMonth] = useState(`${initialDate.slice(0, 7)}-01`);
  const [selected, setSelected] = useState(initialDate);
  const [view, setView] = useState<'calendar' | 'trash'>('calendar');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<CalendarEvent | null | undefined>();
  const [blockEditor, setBlockEditor] = useState(false);
  const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = { ...monthRange(month), trash: view === 'trash' };
      const [nextEvents, nextBlocks] = await Promise.all([client.list(query), client.listBlocks(query)]);
      setEvents(nextEvents);
      setBlocks(nextBlocks);
    } catch {
      Message.error(t('personal.calendar.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [client, month, t, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayEvents = useMemo(
    () => events.filter((event) => event.startLocalDate <= selected && event.endLocalDate > selected),
    [events, selected]
  );
  const dayBlocks = useMemo(() => blocks.filter((block) => block.localDate === selected), [blocks, selected]);

  const updateWithScope = async (input: CalendarEventUpdateInput, scope: CalendarScope) => {
    await client.update(input, scope);
    setEditor(undefined);
    setPendingScope(null);
    await load();
  };

  const save = async (input: CalendarEventCreateInput | CalendarEventUpdateInput) => {
    if ('id' in input) {
      const current = events.find((event) => event.id === input.id);
      if (current?.seriesId) {
        setPendingScope({ event: current, action: 'edit', input });
        return;
      }
    }
    setSaving(true);
    try {
      if ('id' in input) await updateWithScope(input, 'single');
      else await client.create(input);
      setEditor(undefined);
      await load();
    } catch {
      Message.error(t('personal.calendar.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (event: CalendarEvent) => {
    if (event.seriesId) {
      setPendingScope({ event, action: 'remove' });
      return;
    }
    try {
      await client.remove(event.id, 'single');
      await load();
    } catch {
      Message.error(t('personal.calendar.errors.remove'));
    }
  };

  const chooseScope = async (scope: CalendarScope) => {
    if (!pendingScope) return;
    if (pendingScope.action === 'edit') {
      await updateWithScope(pendingScope.input!, scope);
    } else {
      await client.remove(pendingScope.event.id, scope);
      setPendingScope(null);
      await load();
    }
  };

  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) =>
    t(`personal.calendar.weekdays.${day}`)
  );

  return (
    <PersonalPageShell title={t('personal.calendar.title')} description={t('personal.calendar.description')}>
      <Tabs activeTab={view} onChange={(key) => setView(key as 'calendar' | 'trash')}>
        <Tabs.TabPane key='calendar' title={t('personal.calendar.title')} />
        <Tabs.TabPane key='trash' title={t('personal.tasks.views.trash')} />
      </Tabs>
      <div className='mb-14px flex flex-wrap items-center justify-between gap-8px'>
        <div className='flex items-center gap-4px'>
          <Button
            shape='circle'
            icon={<Left size='15' />}
            aria-label={t('personal.calendar.previousMonth')}
            onClick={() => setMonth(shiftMonth(month, -1))}
          />
          <Button
            type='text'
            onClick={() => {
              const now = localDate();
              setMonth(`${now.slice(0, 7)}-01`);
              setSelected(now);
            }}
          >
            {t('personal.calendar.today')}
          </Button>
          <Button
            shape='circle'
            icon={<Right size='15' />}
            aria-label={t('personal.calendar.nextMonth')}
            onClick={() => setMonth(shiftMonth(month, 1))}
          />
        </div>
        <strong className='text-15px'>{month.slice(0, 7)}</strong>
        {view === 'calendar' ? (
          <div className='flex gap-8px'>
            <Button
              icon={<Time size='16' />}
              aria-label={t('personal.calendar.createBlock')}
              onClick={() => setBlockEditor(true)}
            >
              {t('personal.calendar.createBlock')}
            </Button>
            <Button type='primary' icon={<Add size='16' />} onClick={() => setEditor(null)}>
              {t('personal.calendar.editor.createTitle')}
            </Button>
          </div>
        ) : null}
      </div>
      {loading ? (
        <div className='flex justify-center py-64px'>
          <Spin />
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-18px lg:grid-cols-[minmax(0,1fr)_380px]'>
          <CalendarMonth
            month={month}
            today={localDate()}
            selected={selected}
            events={events}
            weekdays={weekdays}
            onSelect={setSelected}
          />
          <section className='min-w-0 border-t border-border-2 pt-14px lg:border-l lg:border-t-0 lg:pl-18px lg:pt-0'>
            <h2 className='mb-12px mt-0 text-14px font-600'>{selected}</h2>
            <CalendarDayList
              events={dayEvents}
              blocks={dayBlocks}
              trash={view === 'trash'}
              empty={t('personal.calendar.empty')}
              editLabel={view === 'trash' ? t('personal.tasks.actions.restore') : t('common.edit')}
              deleteLabel={view === 'trash' ? t('personal.tasks.actions.destroy') : t('common.delete')}
              onEdit={(event) => setEditor(event)}
              onRemove={(event) => void remove(event)}
              onRestore={async (event) => {
                await client.restore(event.id);
                await load();
              }}
              onDestroy={async (event) => {
                await client.destroy(event.id);
                await load();
              }}
            />
          </section>
        </div>
      )}
      <CalendarEditorDrawer
        visible={editor !== undefined}
        date={selected}
        event={editor ?? null}
        saving={saving}
        onClose={() => setEditor(undefined)}
        onSubmit={(input) => void save(input)}
      />
      <ScheduleBlockDrawer
        visible={blockEditor}
        date={selected}
        saving={saving}
        onClose={() => setBlockEditor(false)}
        onSubmit={async (input) => {
          setSaving(true);
          try {
            await client.createBlock(input);
            setBlockEditor(false);
            await load();
          } finally {
            setSaving(false);
          }
        }}
      />
      <CalendarScopeModal
        visible={pendingScope !== null}
        onCancel={() => setPendingScope(null)}
        onSelect={(scope) => void chooseScope(scope)}
      />
    </PersonalPageShell>
  );
};

export default CalendarPage;
