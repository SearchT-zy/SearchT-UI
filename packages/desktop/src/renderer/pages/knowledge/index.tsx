import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Message, Modal, Radio, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type {
  KnowledgeClient,
  KnowledgeIndexStatus,
  KnowledgeSearchHit,
  KnowledgeSourceType,
} from '@/common/types/searcht/knowledge';
import { useMountedMessage } from '@/renderer/hooks/mcp/useMountedMessage';
import PersonalPageShell from '../personal/PersonalPageShell';
import KnowledgeResults from './components/KnowledgeResults';
import { knowledgeClient } from './knowledgeClient';
import styles from './KnowledgePage.module.css';

type SourceFilter = 'all' | KnowledgeSourceType;
const SEARCH_DELAY = 250;

const KnowledgePage: React.FC<{ client?: KnowledgeClient }> = ({ client = knowledgeClient }) => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [rawMessage, messageContext] = Message.useMessage();
  const message = useMountedMessage(rawMessage);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [hits, setHits] = useState<KnowledgeSearchHit[]>([]);
  const [status, setStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removalCandidate, setRemovalCandidate] = useState<KnowledgeSearchHit | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(
    async (refreshStatus = false) => {
      setLoading(true);
      try {
        const [result, nextStatus] = await Promise.all([
          client.search({ query: debouncedQuery, sourceTypes: filter === 'all' ? undefined : [filter], limit: 50 }),
          refreshStatus ? client.getStatus() : Promise.resolve(null),
        ]);
        setHits(result.hits);
        if (nextStatus) setStatus(nextStatus);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [client, debouncedQuery, filter, message]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DELAY);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const refreshStatus = firstLoad.current;
    firstLoad.current = false;
    void load(refreshStatus);
  }, [load]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const result = await client.rebuild();
      message.success(
        result.failedCount
          ? tRef.current('personal.knowledge.rebuild.partial', { count: result.failedCount })
          : tRef.current('personal.knowledge.rebuild.success', { count: result.indexedCount })
      );
      await load(true);
    } catch {
      message.error(tRef.current('personal.knowledge.errors.rebuild'));
    } finally {
      setRebuilding(false);
    }
  };

  const openSource = (hit: KnowledgeSearchHit) => {
    navigate(
      hit.source.sourceType === 'note'
        ? `/notes?note=${encodeURIComponent(hit.source.sourceId)}`
        : `/inbox?item=${encodeURIComponent(hit.source.sourceId)}`
    );
  };

  const removeSource = async () => {
    if (!removalCandidate) return;
    setRemoving(true);
    try {
      await client.removeSource(removalCandidate.source.id);
      setRemovalCandidate(null);
      message.success(tRef.current('personal.knowledge.remove.success'));
      await load(true);
    } catch {
      message.error(tRef.current('personal.knowledge.errors.remove'));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <PersonalPageShell title={t('personal.knowledge.title')} description={t('personal.knowledge.description')}>
      {messageContext}
      <div className={styles.statusBand}>
        <div className={styles.statusItem}>
          <div className='text-11px text-t-secondary'>{t('personal.knowledge.status.total')}</div>
          <div className='mt-2px text-18px font-600'>{status?.sourceCount ?? 0}</div>
        </div>
        <div className={styles.statusItem}>
          <div className='text-11px text-t-secondary'>{t('personal.knowledge.status.notes')}</div>
          <div className='mt-2px text-18px font-600'>{status?.noteCount ?? 0}</div>
        </div>
        <div className={styles.statusItem}>
          <div className='text-11px text-t-secondary'>{t('personal.knowledge.status.inbox')}</div>
          <div className='mt-2px text-18px font-600'>{status?.inboxCount ?? 0}</div>
        </div>
      </div>
      <div className='mt-16px flex flex-wrap items-center gap-10px'>
        <Input.Search
          type='search'
          className='min-w-220px max-w-520px flex-1'
          aria-label={t('personal.knowledge.search.placeholder')}
          placeholder={t('personal.knowledge.search.placeholder')}
          value={query}
          onChange={setQuery}
        />
        <Radio.Group type='button' value={filter} onChange={(value) => setFilter(value as SourceFilter)}>
          <Radio value='all'>{t('personal.knowledge.filters.all')}</Radio>
          <Radio value='note'>{t('personal.knowledge.filters.notes')}</Radio>
          <Radio value='inbox-item'>{t('personal.knowledge.filters.inbox')}</Radio>
        </Radio.Group>
        <Button
          icon={<Refresh size='16' />}
          loading={rebuilding}
          aria-label={t('personal.knowledge.actions.rebuild')}
          onClick={() => void rebuild()}
        >
          {t('personal.knowledge.actions.rebuild')}
        </Button>
      </div>
      <div className='mt-16px min-h-260px'>
        {loading ? (
          <div className='flex justify-center py-64px'>
            <Spin />
          </div>
        ) : loadFailed ? (
          <div role='alert' className='flex flex-col items-center gap-12px py-56px text-t-secondary'>
            <span>{t('personal.knowledge.errors.load')}</span>
            <Button icon={<Refresh size='16' />} onClick={() => void load(true)}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <KnowledgeResults
            hits={hits}
            empty={query ? t('personal.knowledge.search.noResults') : t('personal.knowledge.empty')}
            sourceLabels={{
              note: t('personal.knowledge.sourceTypes.note'),
              inbox: t('personal.knowledge.sourceTypes.inbox'),
            }}
            openLabel={t('personal.knowledge.actions.openNamed')}
            removeLabel={t('personal.knowledge.actions.removeNamed')}
            onOpen={openSource}
            onRemove={setRemovalCandidate}
          />
        )}
      </div>
      <Modal
        visible={removalCandidate !== null}
        title={t('personal.knowledge.remove.title')}
        okText={t('personal.knowledge.remove.confirmAction')}
        cancelText={t('common.cancel')}
        confirmLoading={removing}
        onOk={() => void removeSource()}
        onCancel={() => setRemovalCandidate(null)}
        unmountOnExit
      >
        {t('personal.knowledge.remove.description', { title: removalCandidate?.source.title ?? '' })}
      </Modal>
    </PersonalPageShell>
  );
};

export default KnowledgePage;
