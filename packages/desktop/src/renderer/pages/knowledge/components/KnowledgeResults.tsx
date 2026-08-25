import React from 'react';
import { Button, Empty, Tag } from '@arco-design/web-react';
import { Delete, Link } from '@icon-park/react';
import type { KnowledgeSearchHit } from '@/common/types/searcht/knowledge';
import styles from '../KnowledgePage.module.css';

type KnowledgeResultsProps = {
  hits: KnowledgeSearchHit[];
  empty: string;
  sourceLabels: { note: string; inbox: string };
  openLabel: string;
  removeLabel: string;
  onOpen: (hit: KnowledgeSearchHit) => void;
  onRemove: (hit: KnowledgeSearchHit) => void;
};

const KnowledgeResults: React.FC<KnowledgeResultsProps> = ({
  hits,
  empty,
  sourceLabels,
  openLabel,
  removeLabel,
  onOpen,
  onRemove,
}) => {
  if (!hits.length) return <Empty className='py-64px' description={empty} />;
  return (
    <div role='list' className={styles.results}>
      {hits.map((hit) => (
        <article role='listitem' key={hit.source.id} className={styles.resultRow}>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-8px'>
              <h2 className='m-0 text-14px font-600 leading-22px'>{hit.source.title}</h2>
              <Tag size='small'>{hit.source.sourceType === 'note' ? sourceLabels.note : sourceLabels.inbox}</Tag>
            </div>
            <p className='mb-0 mt-5px whitespace-pre-wrap break-words text-13px leading-21px text-t-secondary'>
              {hit.snippet}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-2px'>
            <Button
              type='text'
              shape='circle'
              icon={<Link size='17' />}
              aria-label={openLabel.replace('{{title}}', hit.source.title)}
              onClick={() => onOpen(hit)}
            />
            {hit.source.sourceType === 'inbox-item' ? (
              <Button
                type='text'
                status='danger'
                shape='circle'
                icon={<Delete size='17' />}
                aria-label={removeLabel.replace('{{title}}', hit.source.title)}
                onClick={() => onRemove(hit)}
              />
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
};

export default KnowledgeResults;
