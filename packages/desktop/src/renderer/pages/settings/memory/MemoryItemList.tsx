import React from 'react';
import { Button, Empty, Tag } from '@arco-design/web-react';
import { Delete, Edit, Refresh } from '@icon-park/react';
import type { MemoryItem, MemorySourceKind, MemoryView } from '@/common/types/searcht/memory';
import styles from './MemorySettings.module.css';

type MemoryItemListProps = {
  memories: MemoryItem[];
  view: MemoryView;
  emptyText: string;
  editLabel: string;
  forgetLabel: string;
  reactivateLabel: string;
  sensitiveLabel: string;
  typeLabel: (type: MemoryItem['memoryType']) => string;
  scopeLabel: (memory: MemoryItem) => string;
  sourceLabel: (kind: MemorySourceKind) => string;
  onEdit: (memory: MemoryItem) => void;
  onForget: (memory: MemoryItem) => void;
  onReactivate: (memory: MemoryItem) => void;
};

const MemoryItemList: React.FC<MemoryItemListProps> = ({
  memories,
  view,
  emptyText,
  editLabel,
  forgetLabel,
  reactivateLabel,
  sensitiveLabel,
  typeLabel,
  scopeLabel,
  sourceLabel,
  onEdit,
  onForget,
  onReactivate,
}) => {
  if (!memories.length) return <Empty description={emptyText} />;

  return (
    <div className={styles.list}>
      {memories.map((memory) => (
        <article className={styles.row} key={memory.id}>
          <div className={styles.rowBody}>
            <p className={styles.content}>{memory.content}</p>
            <div className={styles.metadata}>
              <Tag size='small'>{typeLabel(memory.memoryType)}</Tag>
              {memory.sensitivity === 'sensitive' ? (
                <Tag size='small' color='orangered'>
                  {sensitiveLabel}
                </Tag>
              ) : null}
              <span>{scopeLabel(memory)}</span>
              <span>{Math.round(memory.confidence * 100)}%</span>
            </div>
            <p className={styles.reason}>{memory.reason}</p>
            {memory.sourceReferences.length ? (
              <div className={styles.sources}>
                {memory.sourceReferences.map((source) => (
                  <span key={`${source.kind}:${source.id}`}>
                    {sourceLabel(source.kind)} · {source.label ?? source.id}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.actions}>
            {view === 'expired' ? (
              <Button size='small' type='primary' icon={<Refresh />} onClick={() => onReactivate(memory)}>
                {reactivateLabel}
              </Button>
            ) : null}
            <Button size='small' type='text' icon={<Edit />} onClick={() => onEdit(memory)}>
              {editLabel}
            </Button>
            <Button size='small' type='text' status='danger' icon={<Delete />} onClick={() => onForget(memory)}>
              {forgetLabel}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
};

export default MemoryItemList;
