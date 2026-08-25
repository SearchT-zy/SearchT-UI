import React from 'react';
import { Button, Drawer, Empty, Spin } from '@arco-design/web-react';
import { Undo } from '@icon-park/react';
import type { NoteRevision } from '@/common/types/searcht/notes';

type RevisionDrawerProps = {
  visible: boolean;
  loading: boolean;
  revisions: NoteRevision[];
  title: string;
  empty: string;
  restoreLabel: string;
  versionLabel: string;
  onClose: () => void;
  onRestore: (revision: NoteRevision) => void;
};

const RevisionDrawer: React.FC<RevisionDrawerProps> = ({
  visible,
  loading,
  revisions,
  title,
  empty,
  restoreLabel,
  versionLabel,
  onClose,
  onRestore,
}) => (
  <Drawer
    width={420}
    style={{ maxWidth: '100vw' }}
    visible={visible}
    title={title}
    footer={null}
    onCancel={onClose}
    unmountOnExit
  >
    <div role='dialog' aria-modal='true' aria-label={title}>
      {loading ? (
        <div className='flex justify-center py-48px'>
          <Spin />
        </div>
      ) : revisions.length ? (
        <div className='divide-y divide-border-2'>
          {revisions.map((revision) => (
            <div key={revision.id} className='flex items-start gap-10px py-12px'>
              <div className='min-w-0 flex-1'>
                <div className='text-13px font-500'>
                  {versionLabel.replace('{{number}}', String(revision.revisionNumber))}
                </div>
                <div className='mt-4px line-clamp-2 whitespace-pre-wrap text-12px text-t-secondary'>
                  {revision.body}
                </div>
              </div>
              <Button
                type='text'
                icon={<Undo size='16' />}
                aria-label={restoreLabel}
                onClick={() => onRestore(revision)}
              >
                {restoreLabel}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Empty description={empty} />
      )}
    </div>
  </Drawer>
);

export default RevisionDrawer;
