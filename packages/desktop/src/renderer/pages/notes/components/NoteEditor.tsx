import React from 'react';
import { Button, Empty, Input, Spin } from '@arco-design/web-react';
import { Delete, History, Inbox, Save, Undo } from '@icon-park/react';
import type { NoteDetail, NoteView } from '@/common/types/searcht/notes';

type NoteEditorProps = {
  detail: NoteDetail | null;
  view: NoteView;
  loading: boolean;
  saving: boolean;
  title: string;
  body: string;
  labels: {
    selectPrompt: string;
    title: string;
    body: string;
    save: string;
    saved: string;
    saving: string;
    history: string;
    archive: string;
    unarchive: string;
    remove: string;
    restore: string;
    destroy: string;
    provenanceInbox: string;
  };
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSave: () => void;
  onHistory: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onDestroy: () => void;
};

const NoteEditor: React.FC<NoteEditorProps> = ({
  detail,
  view,
  loading,
  saving,
  title,
  body,
  labels,
  onTitleChange,
  onBodyChange,
  onSave,
  onHistory,
  onArchive,
  onUnarchive,
  onRemove,
  onRestore,
  onDestroy,
}) => {
  if (loading) return <Spin className='m-auto' />;
  if (!detail) return <Empty className='m-auto' description={labels.selectPrompt} />;
  const editable = view !== 'trash';
  return (
    <article className='box-border flex size-full min-h-0 flex-col p-18px'>
      <div className='flex flex-wrap items-center gap-8px border-b border-border-2 pb-12px'>
        <Input
          className='min-w-220px flex-1'
          aria-label={labels.title}
          value={title}
          readOnly={!editable}
          onChange={onTitleChange}
        />
        {editable ? (
          <>
            <Button type='primary' icon={<Save size='16' />} loading={saving} aria-label={labels.save} onClick={onSave}>
              {labels.save}
            </Button>
            <Button icon={<History size='16' />} aria-label={labels.history} onClick={onHistory} />
          </>
        ) : null}
      </div>
      <Input.TextArea
        className='mt-14px min-h-260px flex-1'
        aria-label={labels.body}
        value={body}
        readOnly={!editable}
        autoSize={false}
        onChange={onBodyChange}
      />
      <div className='mt-10px min-h-20px text-12px text-t-secondary'>{saving ? labels.saving : labels.saved}</div>
      {detail.sourceReferences.length ? (
        <div className='mt-8px flex items-center gap-6px border-t border-border-2 pt-10px text-12px text-t-secondary'>
          <Inbox size='15' />
          <span>{labels.provenanceInbox}</span>
        </div>
      ) : null}
      <div className='mt-12px flex flex-wrap gap-8px border-t border-border-2 pt-12px'>
        {view === 'trash' ? (
          <>
            <Button icon={<Undo size='16' />} aria-label={labels.restore} onClick={onRestore}>
              {labels.restore}
            </Button>
            <Button status='danger' icon={<Delete size='16' />} aria-label={labels.destroy} onClick={onDestroy}>
              {labels.destroy}
            </Button>
          </>
        ) : (
          <>
            <Button
              aria-label={view === 'archived' ? labels.unarchive : labels.archive}
              onClick={view === 'archived' ? onUnarchive : onArchive}
            >
              {view === 'archived' ? labels.unarchive : labels.archive}
            </Button>
            <Button status='danger' icon={<Delete size='16' />} aria-label={labels.remove} onClick={onRemove}>
              {labels.remove}
            </Button>
          </>
        )}
      </div>
    </article>
  );
};

export default NoteEditor;
