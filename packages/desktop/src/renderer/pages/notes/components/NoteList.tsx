import React from 'react';
import { Button, Empty } from '@arco-design/web-react';
import { Notes } from '@icon-park/react';
import type { Note } from '@/common/types/searcht/notes';
import styles from '../NotesPage.module.css';

type NoteListProps = {
  notes: Note[];
  selectedId: string | null;
  emptyText: string;
  openLabel: string;
  onOpen: (note: Note) => void;
};

const NoteList: React.FC<NoteListProps> = ({ notes, selectedId, emptyText, openLabel, onOpen }) => {
  if (!notes.length) return <Empty className='py-48px' description={emptyText} />;
  return (
    <div role='list' className='divide-y divide-border-2'>
      {notes.map((note) => (
        <div role='listitem' key={note.id} className={selectedId === note.id ? styles.listRowSelected : styles.listRow}>
          <Button
            type='text'
            long
            className={styles.listButton}
            aria-label={openLabel.replace('{{title}}', note.title)}
            icon={<Notes size='17' />}
            onClick={() => onOpen(note)}
          >
            <span className='min-w-0 flex-1 text-left'>
              <span className='block truncate text-13px font-500 text-t-primary'>{note.title}</span>
              <span className='mt-3px block truncate text-12px text-t-secondary'>
                {note.body || new Date(note.updatedAt).toLocaleString()}
              </span>
            </span>
          </Button>
        </div>
      ))}
    </div>
  );
};

export default NoteList;
