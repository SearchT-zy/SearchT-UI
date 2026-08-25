import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Input, Message, Select, Spin, Tabs } from '@arco-design/web-react';
import { Add, Close, Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { InboxItem, InboxItemDetail, InboxListView, InboxPreviewDescriptor } from '@/common/types/searcht/inbox';
import PersonalPageShell from '../personal/PersonalPageShell';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useMountedMessage } from '@/renderer/hooks/mcp/useMountedMessage';
import InboxCaptureDrawer from './components/InboxCaptureDrawer';
import InboxConversionDrawer from './components/InboxConversionDrawer';
import InboxDetail from './components/InboxDetail';
import InboxList from './components/InboxList';
import { inboxClient, type InboxDataClient } from './inboxClient';
import { createInboxFileSources, useInboxDrop } from './hooks/useInboxDrop';
import styles from './InboxPage.module.css';

const InboxPage: React.FC<{ client?: InboxDataClient }> = ({ client = inboxClient }) => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [rawMessage, messageContext] = Message.useMessage();
  const message = useMountedMessage(rawMessage);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedItemId = searchParams.get('item');
  const isMobile = useLayoutContext()?.isMobile ?? false;
  const [view, setView] = useState<InboxListView>('pending');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | InboxItem['kind']>('all');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [detail, setDetail] = useState<InboxItemDetail | null>(null);
  const [preview, setPreview] = useState<InboxPreviewDescriptor | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captureVisible, setCaptureVisible] = useState(false);
  const [conversionMode, setConversionMode] = useState<'task' | 'calendar-event' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.list({
        view,
        search: search || undefined,
        kinds: kind === 'all' ? undefined : [kind],
      });
      setItems(result.items);
      setCheckedIds(new Set());
    } catch {
      message.error(tRef.current('personal.inbox.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [client, kind, message, search, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const openById = useCallback(
    async (itemId: string) => {
      setDetailLoading(true);
      setPreview(null);
      try {
        const nextDetail = await client.get(itemId);
        setDetail(nextDetail);
        if (nextDetail) {
          setView(
            nextDetail.item.deletedAt !== null
              ? 'trash'
              : nextDetail.item.archivedAt !== null
                ? 'archived'
                : nextDetail.item.state === 'organized'
                  ? 'organized'
                  : 'pending'
          );
        }
        if (nextDetail?.item.kind === 'file') {
          setPreviewLoading(true);
          try {
            setPreview(await client.getPreview(itemId));
          } finally {
            setPreviewLoading(false);
          }
        }
      } catch {
        message.error(tRef.current('personal.inbox.errors.detail'));
      } finally {
        setDetailLoading(false);
      }
    },
    [client, message]
  );

  useEffect(() => {
    if (requestedItemId) void openById(requestedItemId);
  }, [openById, requestedItemId]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
      setDetail(null);
      setPreview(null);
      await load();
      return true;
    } catch {
      message.error(tRef.current('personal.inbox.errors.save'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const labels = useMemo(
    () => ({
      selectPrompt: t('personal.inbox.detail.selectPrompt'),
      editTitle: t('personal.inbox.actions.editTitle'),
      originalName: t('personal.inbox.detail.originalName'),
      originalPath: t('personal.inbox.detail.originalPath'),
      browserImport: t('personal.inbox.detail.browserImport'),
      organizedCount: t('personal.inbox.detail.organizedCount'),
      restore: t('personal.inbox.actions.restore'),
      destroy: t('personal.inbox.actions.destroy'),
      toTask: t('personal.inbox.actions.toTask'),
      toEvent: t('personal.inbox.actions.toEvent'),
      toNote: t('personal.inbox.actions.toNote'),
      toKnowledge: t('personal.inbox.actions.toKnowledge'),
      archive: t('personal.inbox.actions.archive'),
      remove: t('personal.inbox.actions.remove'),
      preview: t('personal.inbox.preview.label'),
      truncated: t('personal.inbox.preview.truncated'),
      document: t('personal.inbox.preview.document'),
      unsupported: t('personal.inbox.preview.unsupported'),
      missing: t('personal.inbox.preview.missing'),
      reveal: t('personal.inbox.preview.reveal'),
      download: t('personal.inbox.preview.download'),
    }),
    [t]
  );

  const currentId = detail?.item.id;
  const currentIds = currentId ? [currentId] : [];
  const convertToNote = async () => {
    if (!currentId || busy) return;
    const sourceId = currentId;
    setBusy(true);
    try {
      const result = await client.convertToNote({ sourceId, operationId: crypto.randomUUID() });
      setDetail(await client.get(sourceId));
      await load();
      navigate(`/notes?note=${encodeURIComponent(result.targetId)}`);
    } catch {
      message.error(tRef.current('personal.inbox.errors.save'));
    } finally {
      setBusy(false);
    }
  };
  const convertToKnowledge = async () => {
    if (!currentId || busy) return;
    const sourceId = currentId;
    setBusy(true);
    try {
      await client.convertToKnowledge({ sourceId, operationId: crypto.randomUUID() });
      setDetail(await client.get(sourceId));
      await load();
      navigate('/knowledge');
    } catch {
      message.error(tRef.current('personal.inbox.errors.save'));
    } finally {
      setBusy(false);
    }
  };
  const importFiles = (files: File[]) =>
    mutate(async () => {
      const sources = createInboxFileSources(files, window.electronAPI?.getPathForFile);
      const result = await client.importFiles({ files: sources });
      if (result.failed.length) message.warning(tRef.current('personal.inbox.errors.someFiles'));
    });
  const { active: dropActive, dropProps } = useInboxDrop({
    disabled: busy || view === 'trash',
    onFiles: (files) => void importFiles(files),
    onDirectoryRejected: () => message.warning(tRef.current('personal.inbox.drop.directoryRejected')),
  });

  useEffect(
    () => () => {
      if (preview?.url?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(preview.url);
      }
    },
    [preview?.url]
  );

  const downloadPreview = () => {
    if (!preview?.url) return;
    const anchor = document.createElement('a');
    anchor.href = preview.url;
    anchor.download = preview.displayName;
    anchor.click();
  };

  const closeDetail = () => {
    setDetail(null);
    setPreview(null);
  };

  const detailView = (
    <InboxDetail
      detail={detail}
      loading={detailLoading}
      preview={preview}
      previewLoading={previewLoading}
      trash={view === 'trash'}
      busy={busy}
      labels={labels}
      onUpdate={(title) => void mutate(() => client.update({ id: currentId!, title }))}
      onArchive={() => void mutate(() => client.archive(currentIds))}
      onRemove={() => void mutate(() => client.remove(currentIds))}
      onRestore={() => void mutate(() => client.restore(currentIds))}
      onDestroy={() => void mutate(() => client.destroy(currentIds))}
      onConvert={setConversionMode}
      onConvertToNote={() => void convertToNote()}
      onConvertToKnowledge={() => void convertToKnowledge()}
      onReveal={() => currentId && void client.revealManagedFile(currentId)}
      onDownload={downloadPreview}
    />
  );

  return (
    <PersonalPageShell title={t('personal.inbox.title')} description={t('personal.inbox.description')}>
      {messageContext}
      <div className={styles.dropSurface} {...dropProps}>
        {dropActive ? <div className={styles.dropOverlay}>{t('personal.inbox.drop.prompt')}</div> : null}
        <div className='flex flex-col gap-10px'>
          <div className='flex flex-wrap items-center justify-between gap-10px'>
            <Tabs
              activeTab={view}
              onChange={(key) => {
                setView(key as InboxListView);
                setDetail(null);
                setPreview(null);
              }}
            >
              {(['pending', 'organized', 'archived', 'trash'] as const).map((key) => (
                <Tabs.TabPane key={key} title={t(`personal.inbox.views.${key}`)} />
              ))}
            </Tabs>
            <div className='flex flex-wrap items-center gap-8px'>
              {view === 'trash' ? (
                <Button
                  icon={<Delete size='16' />}
                  disabled={items.length === 0}
                  onClick={() => void mutate(() => client.emptyTrash())}
                >
                  {t('personal.inbox.actions.emptyTrash')}
                </Button>
              ) : (
                <Button
                  type='primary'
                  icon={<Add size='16' />}
                  aria-label={t('personal.inbox.capture.open')}
                  onClick={() => setCaptureVisible(true)}
                >
                  {t('personal.inbox.capture.open')}
                </Button>
              )}
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-8px'>
            <Input.Search
              type='search'
              className='min-w-220px max-w-380px flex-1'
              aria-label={t('personal.inbox.search')}
              placeholder={t('personal.inbox.search')}
              value={search}
              onChange={setSearch}
            />
            <Select value={kind} onChange={(value) => setKind(value as typeof kind)} style={{ width: 132 }}>
              <Select.Option value='all'>{t('personal.inbox.kinds.all')}</Select.Option>
              <Select.Option value='text'>{t('personal.inbox.kinds.text')}</Select.Option>
              <Select.Option value='link'>{t('personal.inbox.kinds.link')}</Select.Option>
              <Select.Option value='file'>{t('personal.inbox.kinds.file')}</Select.Option>
            </Select>
            {checkedIds.size > 0 ? (
              <div className='ml-auto flex items-center gap-8px border-l border-border-2 pl-10px'>
                <span className='text-12px text-t-secondary'>{checkedIds.size}</span>
                {view === 'trash' ? (
                  <Button onClick={() => void mutate(() => client.restore(Array.from(checkedIds)))}>
                    {t('personal.inbox.actions.restoreSelected')}
                  </Button>
                ) : (
                  <Button
                    aria-label={t('personal.inbox.actions.archiveSelected')}
                    onClick={() => void mutate(() => client.archive(Array.from(checkedIds)))}
                  >
                    {t('personal.inbox.actions.archiveSelected')}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className={`mt-12px ${styles.workspace}`}>
          <section className={styles.listPane} aria-label={t('personal.inbox.listLabel')}>
            {loading ? (
              <div className='flex justify-center py-52px'>
                <Spin />
              </div>
            ) : (
              <InboxList
                items={items}
                selectedId={detail?.item.id ?? null}
                checkedIds={checkedIds}
                emptyText={t('personal.inbox.empty')}
                selectLabel={t('personal.inbox.selectNamed')}
                onOpen={(item) => void openById(item.id)}
                onCheck={(id, checked) =>
                  setCheckedIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
              />
            )}
          </section>
          {!isMobile ? (
            <section className={styles.detailPane} aria-label={t('personal.inbox.detail.label')}>
              {detailView}
            </section>
          ) : null}
        </div>
      </div>
      <Drawer
        width={480}
        style={{ maxWidth: '100vw' }}
        visible={isMobile && detail !== null}
        title={detail?.item.title ?? t('personal.inbox.detail.label')}
        footer={null}
        closeIcon={<Button type='text' shape='circle' icon={<Close size='18' />} aria-label={t('common.close')} />}
        onCancel={closeDetail}
        unmountOnExit
      >
        <div role='dialog' aria-modal='true' aria-label={detail?.item.title ?? t('personal.inbox.detail.label')}>
          {detailView}
        </div>
      </Drawer>
      <InboxCaptureDrawer
        visible={captureVisible}
        saving={busy}
        labels={{
          title: t('personal.inbox.capture.title'),
          text: t('personal.inbox.kinds.text'),
          link: t('personal.inbox.kinds.link'),
          files: t('personal.inbox.kinds.file'),
          content: t('personal.inbox.fields.content'),
          url: t('personal.inbox.fields.url'),
          optionalTitle: t('personal.inbox.fields.optionalTitle'),
          saveText: t('personal.inbox.capture.saveText'),
          saveLink: t('personal.inbox.capture.saveLink'),
          addFiles: t('personal.inbox.capture.addFiles'),
        }}
        onClose={() => setCaptureVisible(false)}
        onText={(input) => mutate(() => client.captureText(input))}
        onLink={(input) => mutate(() => client.captureLink(input))}
        onFiles={importFiles}
      />
      <InboxConversionDrawer
        item={detail?.item ?? null}
        mode={conversionMode}
        saving={busy}
        labels={{
          title: t('personal.inbox.convert.title'),
          task: t('personal.inbox.actions.toTask'),
          event: t('personal.inbox.actions.toEvent'),
          targetTitle: t('personal.inbox.fields.title'),
          date: t('personal.inbox.fields.date'),
          createTask: t('personal.inbox.convert.createTask'),
          createEvent: t('personal.inbox.convert.createEvent'),
        }}
        onClose={() => setConversionMode(null)}
        onTask={(title) =>
          mutate(() =>
            client.convertToTask({ sourceId: currentId!, operationId: crypto.randomUUID(), target: { title } })
          )
        }
        onEvent={(input) =>
          mutate(() =>
            client.convertToEvent({
              sourceId: currentId!,
              operationId: crypto.randomUUID(),
              target: {
                ...input,
                allDay: true,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
              },
            })
          )
        }
      />
    </PersonalPageShell>
  );
};

export default InboxPage;
