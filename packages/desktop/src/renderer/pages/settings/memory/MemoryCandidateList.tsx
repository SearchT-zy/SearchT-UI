import React from 'react';
import { Button, Empty, Tag } from '@arco-design/web-react';
import { Check, CloseOne } from '@icon-park/react';
import type { MemoryCandidate, MemorySourceKind } from '@/common/types/searcht/memory';
import styles from './MemorySettings.module.css';

type MemoryCandidateListProps = {
  candidates: MemoryCandidate[];
  emptyText: string;
  reviewLabel: string;
  rejectLabel: string;
  typeLabel: (type: MemoryCandidate['memoryType']) => string;
  scopeLabel: (candidate: MemoryCandidate) => string;
  sourceLabel: (kind: MemorySourceKind) => string;
  onReview: (candidate: MemoryCandidate) => void;
  onReject: (candidate: MemoryCandidate) => void;
};

const MemoryCandidateList: React.FC<MemoryCandidateListProps> = ({
  candidates,
  emptyText,
  reviewLabel,
  rejectLabel,
  typeLabel,
  scopeLabel,
  sourceLabel,
  onReview,
  onReject,
}) => {
  if (!candidates.length) return <Empty description={emptyText} />;

  return (
    <div className={styles.list}>
      {candidates.map((candidate) => (
        <article className={styles.row} key={candidate.id}>
          <div className={styles.rowBody}>
            <p className={styles.content}>{candidate.content}</p>
            <div className={styles.metadata}>
              <Tag size='small'>{typeLabel(candidate.memoryType)}</Tag>
              <span>{scopeLabel(candidate)}</span>
              <span>{Math.round(candidate.confidence * 100)}%</span>
            </div>
            <p className={styles.reason}>{candidate.reason}</p>
            {candidate.sourceReferences.length ? (
              <div className={styles.sources}>
                {candidate.sourceReferences.map((source) => (
                  <span key={`${source.kind}:${source.id}`}>
                    {sourceLabel(source.kind)} · {source.label ?? source.id}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.actions}>
            <Button size='small' type='primary' icon={<Check />} onClick={() => onReview(candidate)}>
              {reviewLabel}
            </Button>
            <Button size='small' type='text' status='danger' icon={<CloseOne />} onClick={() => onReject(candidate)}>
              {rejectLabel}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
};

export default MemoryCandidateList;
