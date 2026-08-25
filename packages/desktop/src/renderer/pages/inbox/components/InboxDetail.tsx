import React, { useEffect, useState } from 'react';
import { Button, Empty, Input, Spin } from '@arco-design/web-react';
import { Delete, Edit, Undo } from '@icon-park/react';
import type { InboxItemDetail, InboxPreviewDescriptor } from '@/common/types/searcht/inbox';
import InboxPreview from './InboxPreview';

type Props = {
  detail: InboxItemDetail | null;
  loading: boolean;
  trash: boolean;
  busy: boolean;
  preview: InboxPreviewDescriptor | null;
  previewLoading: boolean;
  labels: Record<string, string>;
  onUpdate(title: string): void;
  onArchive(): void;
  onRemove(): void;
  onRestore(): void;
  onDestroy(): void;
  onConvert(mode: 'task' | 'calendar-event'): void;
  onConvertToNote(): void;
  onConvertToKnowledge(): void;
  onReveal(): void;
  onDownload(): void;
};

const InboxDetail: React.FC<Props> = ({
  detail,
  loading,
  trash,
  busy,
  preview,
  previewLoading,
  labels,
  onUpdate,
  onArchive,
  onRemove,
  onRestore,
  onDestroy,
  onConvert,
  onConvertToNote,
  onConvertToKnowledge,
  onReveal,
  onDownload,
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  useEffect(() => {
    setTitle(detail?.item.title ?? '');
    setEditing(false);
  }, [detail]);
  if (loading) return <Spin className='m-auto' />;
  if (!detail) return <Empty className='m-auto' description={labels.selectPrompt} />;
  const { item, origin, sourceLinks } = detail;
  return (
    <article className='flex min-h-0 flex-1 flex-col overflow-y-auto px-20px py-18px'>
      <div className='flex items-start justify-between gap-12px'>
        {editing ? (
          <Input value={title} onChange={setTitle} aria-label={labels.editTitle} />
        ) : (
          <h2 className='m-0 min-w-0 flex-1 break-words text-17px font-600 leading-24px'>{item.title}</h2>
        )}
        {!trash ? (
          <Button
            shape='circle'
            type='text'
            icon={<Edit size='16' />}
            aria-label={labels.editTitle}
            onClick={() => (editing ? onUpdate(title) : setEditing(true))}
          />
        ) : null}
      </div>
      <div className='mt-16px whitespace-pre-wrap break-words text-13px leading-22px text-t-primary'>
        {item.textContent ?? item.url ?? origin?.originalName}
      </div>
      {origin ? (
        <dl className='mt-18px grid grid-cols-[96px_1fr] gap-x-10px gap-y-7px border-t border-border-2 pt-14px text-12px'>
          <dt className='text-t-secondary'>{labels.originalName}</dt>
          <dd className='m-0 break-all'>{origin.originalName}</dd>
          <dt className='text-t-secondary'>{labels.originalPath}</dt>
          <dd className='m-0 break-all'>{origin.originalPath ?? labels.browserImport}</dd>
        </dl>
      ) : null}
      {item.kind === 'file' ? (
        previewLoading ? (
          <Spin className='mx-auto mt-18px' />
        ) : preview ? (
          <InboxPreview
            descriptor={preview}
            labels={{
              preview: labels.preview,
              truncated: labels.truncated,
              document: labels.document,
              unsupported: labels.unsupported,
              missing: labels.missing,
              reveal: labels.reveal,
              download: labels.download,
            }}
            onReveal={onReveal}
            onDownload={onDownload}
          />
        ) : null
      ) : null}
      {sourceLinks.length ? (
        <div className='mt-18px border-t border-border-2 pt-14px text-12px text-t-secondary'>
          {labels.organizedCount.replace('{{count}}', String(sourceLinks.length))}
        </div>
      ) : null}
      <div className='mt-auto flex flex-wrap gap-8px border-t border-border-2 pt-16px'>
        {trash ? (
          <>
            <Button icon={<Undo size='16' />} loading={busy} aria-label={labels.restore} onClick={onRestore}>
              {labels.restore}
            </Button>
            <Button
              status='danger'
              icon={<Delete size='16' />}
              loading={busy}
              aria-label={labels.destroy}
              onClick={onDestroy}
            >
              {labels.destroy}
            </Button>
          </>
        ) : (
          <>
            <Button type='primary' loading={busy} aria-label={labels.toTask} onClick={() => onConvert('task')}>
              {labels.toTask}
            </Button>
            <Button loading={busy} aria-label={labels.toEvent} onClick={() => onConvert('calendar-event')}>
              {labels.toEvent}
            </Button>
            <Button loading={busy} aria-label={labels.toNote} onClick={onConvertToNote}>
              {labels.toNote}
            </Button>
            <Button loading={busy} aria-label={labels.toKnowledge} onClick={onConvertToKnowledge}>
              {labels.toKnowledge}
            </Button>
            <Button loading={busy} aria-label={labels.archive} onClick={onArchive}>
              {labels.archive}
            </Button>
            <Button status='danger' loading={busy} aria-label={labels.remove} onClick={onRemove}>
              {labels.remove}
            </Button>
          </>
        )}
      </div>
    </article>
  );
};

export default InboxDetail;
