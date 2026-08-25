import React from 'react';
import { Checkbox, Empty } from '@arco-design/web-react';
import type { InboxItem } from '@/common/types/searcht/inbox';
import styles from '../InboxPage.module.css';

type Props = {
  items: InboxItem[];
  selectedId: string | null;
  checkedIds: Set<string>;
  emptyText: string;
  selectLabel: string;
  onOpen(item: InboxItem): void;
  onCheck(id: string, checked: boolean): void;
};

const kindLabel: Record<InboxItem['kind'], string> = { text: 'T', link: 'L', file: 'F' };

const InboxList: React.FC<Props> = ({ items, selectedId, checkedIds, emptyText, selectLabel, onOpen, onCheck }) => {
  if (items.length === 0) return <Empty className='py-52px' description={emptyText} />;
  return (
    <div className='divide-y divide-border-2' role='list'>
      {items.map((item) => (
        <div
          key={item.id}
          className={`${styles.listRow} ${selectedId === item.id ? styles.listRowSelected : ''}`}
          role='listitem'
        >
          <span className={styles.statusRail} data-kind={item.kind} />
          <Checkbox
            aria-label={selectLabel}
            checked={checkedIds.has(item.id)}
            onChange={(checked) => onCheck(item.id, checked)}
          />
          <button className={styles.listButton} type='button' onClick={() => onOpen(item)}>
            <span className={styles.kindMark}>{kindLabel[item.kind]}</span>
            <span className='min-w-0 flex-1'>
              <strong className='block truncate text-13px font-500 text-t-primary'>{item.title}</strong>
              <span className='mt-3px block truncate text-12px text-t-secondary'>
                {item.textContent ?? item.url ?? new Date(item.capturedAt).toLocaleString()}
              </span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
};

export default InboxList;
