import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Spin } from '@arco-design/web-react';
import { Plus, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  MEMORY_TYPES,
  type MemoryCandidate,
  type MemoryClient,
  type MemoryItem,
  type MemorySourceKind,
  type MemoryStatus,
  type MemoryType,
  type MemoryView,
} from '@/common/types/searcht/memory';
import SettingsPageHeader from '../components/SettingsPageHeader';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import MemoryCandidateList from './MemoryCandidateList';
import MemoryEditorModal, { type MemoryEditorMode, type MemoryEditorValue } from './MemoryEditorModal';
import MemoryItemList from './MemoryItemList';
import { memoryClient } from './memoryClient';
import styles from './MemorySettings.module.css';

type MemoryTab = 'candidates' | MemoryView;
type EditorState = {
  mode: MemoryEditorMode;
  initialValue: MemoryEditorValue;
  candidate?: MemoryCandidate;
  memory?: MemoryItem;
};
type ConfirmState = { kind: 'reject'; candidate: MemoryCandidate } | { kind: 'forget'; memory: MemoryItem };

export type MemorySettingsProps = {
  client?: MemoryClient;
  searchDelay?: number;
};

const EMPTY_STATUS: MemoryStatus = { pendingCount: 0, activeCount: 0, expiredCount: 0, sensitiveCount: 0 };

const MemorySettings: React.FC<MemorySettingsProps> = ({ client = memoryClient, searchDelay = 250 }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MemoryTab>('candidates');
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [activeMemories, setActiveMemories] = useState<MemoryItem[]>([]);
  const [expiredMemories, setExpiredMemories] = useState<MemoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [memoryType, setMemoryType] = useState<MemoryType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmState | null>(null);
  const [mutationLoading, setMutationLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = {
        search: search.trim() || undefined,
        memoryTypes: memoryType === 'all' ? undefined : [memoryType],
        limit: 200,
      };
      const [nextStatus, candidateResult, activeResult, expiredResult] = await Promise.all([
        client.getStatus(),
        client.listCandidates({ limit: 200 }),
        client.listMemories({ ...query, view: 'active' }),
        client.listMemories({ ...query, view: 'expired' }),
      ]);
      setStatus(nextStatus);
      setCandidates(candidateResult.candidates);
      setActiveMemories(activeResult.memories);
      setExpiredMemories(expiredResult.memories);
    } catch {
      setError(t('personal.memory.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [client, memoryType, search, t]);

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void load();
    }, searchDelay);
    return () => window.clearTimeout(timer);
  }, [load, searchDelay]);

  const typeLabel = useCallback((type: MemoryType) => t(`personal.memory.types.${type}`), [t]);
  const sourceLabel = useCallback((kind: MemorySourceKind) => t(`personal.memory.sources.${kind}`), [t]);
  const scopeKindLabel = useCallback((kind: MemoryItem['scope']['kind']) => t(`personal.memory.scopes.${kind}`), [t]);
  const scopeLabel = useCallback(
    (value: { scope?: MemoryItem['scope']; proposedScope?: MemoryCandidate['proposedScope'] }) => {
      const scope = value.scope ?? value.proposedScope!;
      const label = scopeKindLabel(scope.kind);
      return scope.kind === 'global' ? label : `${label} / ${scope.id}`;
    },
    [scopeKindLabel]
  );

  const openCreate = () => {
    setEditorError(null);
    setEditor({
      mode: 'create',
      initialValue: {
        content: '',
        memoryType: 'preference',
        scope: { kind: 'global', id: null },
        sensitivity: 'normal',
        confidence: 1,
        reason: '',
        expiresAt: null,
        reviewAt: null,
      },
    });
  };

  const openReview = (candidate: MemoryCandidate) => {
    setEditorError(null);
    setEditor({
      mode: 'review',
      candidate,
      initialValue: {
        content: candidate.content,
        memoryType: candidate.memoryType,
        scope: candidate.proposedScope,
        sensitivity: candidate.sensitivity,
        confidence: candidate.confidence,
        reason: candidate.reason,
        expiresAt: candidate.suggestedExpiresAt,
        reviewAt: null,
      },
    });
  };

  const openEdit = (memory: MemoryItem) => {
    setEditorError(null);
    setEditor({
      mode: 'edit',
      memory,
      initialValue: {
        content: memory.content,
        memoryType: memory.memoryType,
        scope: memory.scope,
        sensitivity: memory.sensitivity,
        confidence: memory.confidence,
        reason: memory.reason,
        expiresAt: memory.expiresAt,
        reviewAt: memory.reviewAt,
      },
    });
  };

  const submitEditor = async (value: MemoryEditorValue) => {
    if (!editor) return;
    setMutationLoading(true);
    setEditorError(null);
    try {
      if (editor.mode === 'review') {
        await client.confirmCandidate({ ...value, candidateId: editor.candidate!.id });
      } else if (editor.mode === 'edit') {
        await client.updateMemory({
          ...value,
          id: editor.memory!.id,
          sourceReferences: editor.memory!.sourceReferences,
        });
      } else {
        await client.createMemory(value);
      }
      setEditor(null);
      await load();
    } catch {
      setEditorError(t('personal.memory.saveFailed'));
    } finally {
      setMutationLoading(false);
    }
  };

  const confirmDestructiveAction = async () => {
    if (!confirmation) return;
    setMutationLoading(true);
    try {
      if (confirmation.kind === 'reject') await client.rejectCandidate(confirmation.candidate.id);
      else await client.forgetMemory(confirmation.memory.id);
      setConfirmation(null);
      await load();
    } catch {
      setError(t('personal.memory.saveFailed'));
    } finally {
      setMutationLoading(false);
    }
  };

  const reactivate = async (memory: MemoryItem) => {
    setMutationLoading(true);
    try {
      await client.updateMemory({
        id: memory.id,
        content: memory.content,
        memoryType: memory.memoryType,
        scope: memory.scope,
        sensitivity: memory.sensitivity,
        confidence: memory.confidence,
        reason: memory.reason,
        sourceReferences: memory.sourceReferences,
        expiresAt: null,
        reviewAt: memory.reviewAt,
      });
      await load();
    } catch {
      setError(t('personal.memory.saveFailed'));
    } finally {
      setMutationLoading(false);
    }
  };

  const tabs = useMemo(
    () => [
      { key: 'candidates', label: t('personal.memory.tabs.candidates'), count: status.pendingCount },
      { key: 'active', label: t('personal.memory.tabs.active'), count: status.activeCount },
      { key: 'expired', label: t('personal.memory.tabs.expired'), count: status.expiredCount },
    ],
    [status, t]
  );
  const statusItems = [
    [t('personal.memory.status.pending'), status.pendingCount],
    [t('personal.memory.status.active'), status.activeCount],
    [t('personal.memory.status.expired'), status.expiredCount],
    [t('personal.memory.status.sensitive'), status.sensitiveCount],
  ] as const;

  return (
    <SettingsPageWrapper>
      <SettingsPageHeader
        title={t('personal.memory.title')}
        description={t('personal.memory.description')}
        actions={
          <Button type='primary' icon={<Plus />} onClick={openCreate}>
            {t('personal.memory.add')}
          </Button>
        }
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as MemoryTab)}
      />

      <div className={styles.statusStrip} aria-label={t('personal.memory.status.label')}>
        {statusItems.map(([label, value]) => (
          <div className={styles.statusCell} key={label}>
            <span className={styles.statusValue}>{value}</span>
            <span className={styles.statusLabel}>{label}</span>
          </div>
        ))}
      </div>

      {tab !== 'candidates' ? (
        <div className={styles.toolbar}>
          <Input
            aria-label={t('personal.memory.searchPlaceholder')}
            prefix={<Search />}
            placeholder={t('personal.memory.searchPlaceholder')}
            value={search}
            allowClear
            onChange={setSearch}
          />
          <Select
            aria-label={t('personal.memory.allTypes')}
            className='w-180px shrink-0'
            value={memoryType}
            options={[
              { value: 'all', label: t('personal.memory.allTypes') },
              ...MEMORY_TYPES.map((type) => ({ value: type, label: typeLabel(type) })),
            ]}
            onChange={(value: MemoryType | 'all') => setMemoryType(value)}
          />
        </div>
      ) : null}

      {error ? (
        <div
          role='alert'
          className='mt-16px flex items-center justify-between gap-12px rd-6px bg-danger-1 px-12px py-9px text-13px text-danger-6'
        >
          <span>{error}</span>
          <Button size='small' onClick={() => void load()}>
            {t('personal.memory.retry')}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className='h-220px flex items-center justify-center'>
          <Spin />
        </div>
      ) : tab === 'candidates' ? (
        <MemoryCandidateList
          candidates={candidates}
          emptyText={t('personal.memory.empty.candidates')}
          reviewLabel={t('personal.memory.actions.review')}
          rejectLabel={t('personal.memory.actions.reject')}
          typeLabel={typeLabel}
          scopeLabel={scopeLabel}
          sourceLabel={sourceLabel}
          onReview={openReview}
          onReject={(candidate) => setConfirmation({ kind: 'reject', candidate })}
        />
      ) : (
        <MemoryItemList
          memories={tab === 'active' ? activeMemories : expiredMemories}
          view={tab}
          emptyText={t(`personal.memory.empty.${tab}`)}
          editLabel={t('personal.memory.actions.edit')}
          forgetLabel={t('personal.memory.actions.forget')}
          reactivateLabel={t('personal.memory.actions.reactivate')}
          sensitiveLabel={t('personal.memory.sensitivity.sensitive')}
          typeLabel={typeLabel}
          scopeLabel={scopeLabel}
          sourceLabel={sourceLabel}
          onEdit={openEdit}
          onForget={(memory) => setConfirmation({ kind: 'forget', memory })}
          onReactivate={(memory) => void reactivate(memory)}
        />
      )}

      <MemoryEditorModal
        visible={Boolean(editor)}
        mode={editor?.mode ?? 'create'}
        initialValue={
          editor?.initialValue ?? {
            content: '',
            memoryType: 'preference',
            scope: { kind: 'global', id: null },
            sensitivity: 'normal',
            confidence: 1,
            reason: '',
            expiresAt: null,
            reviewAt: null,
          }
        }
        title={t(`personal.memory.editor.${editor?.mode ?? 'create'}Title`)}
        okText={t(
          editor?.mode === 'review'
            ? 'personal.memory.actions.confirmMemory'
            : editor?.mode === 'edit'
              ? 'personal.memory.actions.saveMemory'
              : 'personal.memory.actions.createMemory'
        )}
        cancelText={t('personal.memory.actions.cancel')}
        loading={mutationLoading}
        error={editorError}
        labels={{
          content: t('personal.memory.editor.content'),
          type: t('personal.memory.editor.type'),
          scope: t('personal.memory.editor.scope'),
          scopeId: t('personal.memory.editor.scopeId'),
          sensitivity: t('personal.memory.editor.sensitivity'),
          confidence: t('personal.memory.editor.confidence'),
          reason: t('personal.memory.editor.reason'),
          expiresAt: t('personal.memory.editor.expiresAt'),
          reviewAt: t('personal.memory.editor.reviewAt'),
        }}
        typeLabel={typeLabel}
        scopeLabel={scopeKindLabel}
        sensitivityLabel={(sensitivity) => t(`personal.memory.sensitivity.${sensitivity}`)}
        onCancel={() => setEditor(null)}
        onSubmit={(value) => void submitEditor(value)}
      />

      <Modal
        visible={Boolean(confirmation)}
        title={t(
          confirmation?.kind === 'forget'
            ? 'personal.memory.confirm.forgetTitle'
            : 'personal.memory.confirm.rejectTitle'
        )}
        okText={t(
          confirmation?.kind === 'forget'
            ? 'personal.memory.actions.confirmForget'
            : 'personal.memory.actions.confirmReject'
        )}
        cancelText={t('personal.memory.actions.cancel')}
        okButtonProps={{ status: 'danger' }}
        confirmLoading={mutationLoading}
        onCancel={() => setConfirmation(null)}
        onOk={() => void confirmDestructiveAction()}
      >
        {confirmation?.kind === 'forget' ? <p>{t('personal.memory.confirm.forgetDescription')}</p> : null}
      </Modal>
    </SettingsPageWrapper>
  );
};

export default MemorySettings;
