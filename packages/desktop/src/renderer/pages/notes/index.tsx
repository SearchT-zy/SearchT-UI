import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Input, Message, Modal, Spin, Tabs } from '@arco-design/web-react';
import { Add, Close, Delete, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { Note, NoteClient, NoteDetail, NoteRevision, NoteView } from '@/common/types/searcht/notes';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useMountedMessage } from '@/renderer/hooks/mcp/useMountedMessage';
import PersonalPageShell from '../personal/PersonalPageShell';
import NoteEditor from './components/NoteEditor';
import NoteList from './components/NoteList';
import RevisionDrawer from './components/RevisionDrawer';
import { noteClient } from './noteClient';
import styles from './NotesPage.module.css';

const AUTOSAVE_DELAY = 700;

const NotesPage: React.FC<{ client?: NoteClient }> = ({ client = noteClient }) => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [rawMessage, messageContext] = Message.useMessage();
  const message = useMountedMessage(rawMessage);
  const [searchParams] = useSearchParams();
  const requestedNoteId = searchParams.get('note');
  const isMobile = useLayoutContext()?.isMobile ?? false;
  const [view, setView] = useState<NoteView>('active');
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revisionVisible, setRevisionVisible] = useState(false);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisions, setRevisions] = useState<NoteRevision[]>([]);
  const [emptyTrashVisible, setEmptyTrashVisible] = useState(false);
  const [destroyCandidateId, setDestroyCandidateId] = useState<string | null>(null);
  const autosaveReady = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setNotes((await client.list({ view, search: search || undefined })).notes);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client, message, search, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const openById = useCallback(
    async (noteId: string) => {
      setDetailLoading(true);
      try {
        const next = await client.get(noteId);
        if (next) {
          setView(next.note.deletedAt ? 'trash' : next.note.archivedAt ? 'archived' : 'active');
        }
        setDetail(next);
        setTitle(next?.note.title ?? '');
        setBody(next?.note.body ?? '');
        autosaveReady.current = false;
      } catch {
        message.error(tRef.current('personal.notes.errors.detail'));
      } finally {
        setDetailLoading(false);
      }
    },
    [client, message]
  );

  useEffect(() => {
    if (requestedNoteId) void openById(requestedNoteId);
  }, [openById, requestedNoteId]);

  const save = useCallback(async () => {
    if (!detail || view === 'trash') return;
    if (detail.note.title === title.trim() && detail.note.body === body) return;
    setSaving(true);
    try {
      const updated = await client.update({ id: detail.note.id, title, body });
      setDetail(updated);
      setTitle(updated.note.title);
      setBody(updated.note.body);
      await load();
    } catch {
      message.error(tRef.current('personal.notes.errors.save'));
    } finally {
      setSaving(false);
    }
  }, [body, client, detail, load, message, title, view]);

  useEffect(() => {
    if (!detail || view === 'trash') return;
    if (!autosaveReady.current) {
      autosaveReady.current = true;
      return;
    }
    const timeout = window.setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timeout);
  }, [body, detail, save, title, view]);

  const create = async () => {
    setSaving(true);
    try {
      const created = await client.create({ title: t('personal.notes.untitled'), body: '' });
      setDetail(created);
      setTitle(created.note.title);
      setBody(created.note.body);
      await load();
    } catch {
      message.error(tRef.current('personal.notes.errors.create'));
    } finally {
      setSaving(false);
    }
  };

  const mutate = async (operation: () => Promise<unknown>): Promise<boolean> => {
    setSaving(true);
    try {
      await operation();
      setDetail(null);
      setTitle('');
      setBody('');
      await load();
      return true;
    } catch {
      message.error(tRef.current('personal.notes.errors.lifecycle'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async () => {
    if (!detail) return;
    setRevisionVisible(true);
    setRevisionLoading(true);
    try {
      setRevisions((await client.listRevisions({ noteId: detail.note.id, limit: 100 })).revisions);
    } catch {
      message.error(tRef.current('personal.notes.errors.revisions'));
    } finally {
      setRevisionLoading(false);
    }
  };

  const restoreRevision = async (revision: NoteRevision) => {
    if (!detail) return;
    setSaving(true);
    try {
      const restored = await client.restoreRevision({ noteId: detail.note.id, revisionId: revision.id });
      setDetail(restored);
      setTitle(restored.note.title);
      setBody(restored.note.body);
      setRevisionVisible(false);
      await load();
    } catch {
      message.error(tRef.current('personal.notes.errors.restoreRevision'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDestroy = () => {
    if (!detail) return;
    setDestroyCandidateId(detail.note.id);
  };

  const destroyNote = async () => {
    if (!destroyCandidateId) return;
    if (await mutate(() => client.destroy([destroyCandidateId]))) setDestroyCandidateId(null);
  };

  const emptyTrash = async () => {
    if (await mutate(() => client.emptyTrash())) setEmptyTrashVisible(false);
  };

  const labels = useMemo(
    () => ({
      selectPrompt: t('personal.notes.editor.selectPrompt'),
      title: t('personal.notes.fields.title'),
      body: t('personal.notes.fields.body'),
      save: t('personal.notes.actions.save'),
      saved: t('personal.notes.autosave.saved'),
      saving: t('personal.notes.autosave.saving'),
      history: t('personal.notes.actions.history'),
      archive: t('personal.notes.actions.archive'),
      unarchive: t('personal.notes.actions.unarchive'),
      remove: t('personal.notes.actions.remove'),
      restore: t('personal.notes.actions.restore'),
      destroy: t('personal.notes.actions.destroy'),
      provenanceInbox: t('personal.notes.provenance.inbox'),
    }),
    [t]
  );
  const editor = (
    <NoteEditor
      detail={detail}
      view={view}
      loading={detailLoading}
      saving={saving}
      title={title}
      body={body}
      labels={labels}
      onTitleChange={setTitle}
      onBodyChange={setBody}
      onSave={() => void save()}
      onHistory={() => void openHistory()}
      onArchive={() => detail && void mutate(() => client.archive([detail.note.id]))}
      onUnarchive={() => detail && void mutate(() => client.unarchive([detail.note.id]))}
      onRemove={() => detail && void mutate(() => client.remove([detail.note.id]))}
      onRestore={() => detail && void mutate(() => client.restore([detail.note.id]))}
      onDestroy={confirmDestroy}
    />
  );

  return (
    <PersonalPageShell title={t('personal.notes.title')} description={t('personal.notes.description')}>
      {messageContext}
      <div className='flex flex-col gap-10px'>
        <div className='flex flex-wrap items-center justify-between gap-10px'>
          <Tabs
            activeTab={view}
            onChange={(key) => {
              setView(key as NoteView);
              setDetail(null);
            }}
          >
            {(['active', 'archived', 'trash'] as const).map((key) => (
              <Tabs.TabPane key={key} title={t(`personal.notes.views.${key}`)} />
            ))}
          </Tabs>
          <div className='flex items-center gap-8px'>
            {view === 'trash' ? (
              <Button icon={<Delete size='16' />} disabled={!notes.length} onClick={() => setEmptyTrashVisible(true)}>
                {t('personal.notes.actions.emptyTrash')}
              </Button>
            ) : null}
            <Button
              type='primary'
              icon={<Add size='16' />}
              aria-label={t('personal.notes.actions.create')}
              onClick={() => void create()}
            >
              {t('personal.notes.actions.create')}
            </Button>
          </div>
        </div>
        <Input.Search
          type='search'
          className='max-w-380px'
          aria-label={t('personal.notes.search')}
          placeholder={t('personal.notes.search')}
          value={search}
          onChange={setSearch}
        />
      </div>
      <div className={`mt-12px ${styles.workspace}`}>
        <section className={styles.listPane} aria-label={t('personal.notes.listLabel')}>
          {loading ? (
            <div className='flex justify-center py-52px'>
              <Spin />
            </div>
          ) : loadFailed ? (
            <div role='alert' className='flex flex-col items-center gap-12px py-48px text-t-secondary'>
              <span>{t('personal.notes.errors.load')}</span>
              <Button icon={<Refresh size='16' />} onClick={() => void load()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (
            <NoteList
              notes={notes}
              selectedId={detail?.note.id ?? null}
              emptyText={t('personal.notes.empty')}
              openLabel={t('personal.notes.openNamed')}
              onOpen={(note) => void openById(note.id)}
            />
          )}
        </section>
        {!isMobile ? (
          <section className={styles.editorPane} aria-label={t('personal.notes.editor.label')}>
            {editor}
          </section>
        ) : null}
      </div>
      <Drawer
        width={560}
        style={{ maxWidth: '100vw' }}
        visible={isMobile && detail !== null}
        title={detail?.note.title ?? t('personal.notes.editor.label')}
        footer={null}
        closeIcon={<Button type='text' shape='circle' icon={<Close size='18' />} aria-label={t('common.close')} />}
        onCancel={() => setDetail(null)}
        unmountOnExit
      >
        <div role='dialog' aria-modal='true' aria-label={detail?.note.title ?? t('personal.notes.editor.label')}>
          {editor}
        </div>
      </Drawer>
      <RevisionDrawer
        visible={revisionVisible}
        loading={revisionLoading}
        revisions={revisions}
        title={t('personal.notes.revisions.title')}
        empty={t('personal.notes.revisions.empty')}
        restoreLabel={t('personal.notes.revisions.restore')}
        versionLabel={t('personal.notes.revisions.version')}
        onClose={() => setRevisionVisible(false)}
        onRestore={(revision) => void restoreRevision(revision)}
      />
      <Modal
        visible={emptyTrashVisible}
        title={t('personal.notes.trash.emptyTitle')}
        okText={t('personal.notes.trash.confirmEmpty')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        okButtonProps={{ status: 'danger' }}
        onOk={() => void emptyTrash()}
        onCancel={() => setEmptyTrashVisible(false)}
        unmountOnExit
      >
        {t('personal.notes.trash.emptyDescription')}
      </Modal>
      <Modal
        visible={destroyCandidateId !== null}
        title={t('personal.notes.trash.destroyTitle')}
        okText={t('personal.notes.actions.destroy')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        okButtonProps={{ status: 'danger' }}
        onOk={() => void destroyNote()}
        onCancel={() => setDestroyCandidateId(null)}
        unmountOnExit
      >
        {t('personal.notes.trash.destroyDescription')}
      </Modal>
    </PersonalPageShell>
  );
};

export default NotesPage;
