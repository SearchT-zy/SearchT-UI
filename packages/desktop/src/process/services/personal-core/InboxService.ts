import { randomUUID } from 'node:crypto';
import type {
  InboxConversionResult,
  InboxEventConversionInput,
  InboxFileImportInput,
  InboxImportResult,
  InboxItem,
  InboxItemDetail,
  InboxKnowledgeConversionInput,
  InboxListQuery,
  InboxListResult,
  InboxLinkCaptureInput,
  InboxMutationResult,
  InboxNoteConversionInput,
  InboxPendingSummary,
  InboxPreviewDescriptor,
  InboxTaskConversionInput,
  InboxTextCaptureInput,
  InboxUpdateInput,
} from '@/common/types/searcht/inbox';
import {
  conversionTargetId,
  normalizeInboxFileSource,
  normalizeInboxLink,
  normalizeInboxText,
} from '@/common/searcht/inboxValidation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { CalendarService } from './CalendarService';
import { KnowledgeService, type InboxKnowledgeDocument } from './content/KnowledgeService';
import { NoteService } from './content/NoteService';
import type { InboxFileStore } from './InboxFileStore';
import { InboxRepository } from './InboxRepository';
import { TaskService } from './TaskService';

export class InboxService {
  private readonly repository: InboxRepository;
  private readonly tasks: TaskService;
  private readonly calendar: CalendarService;
  private readonly knowledge: KnowledgeService;
  private readonly notes: NoteService;

  constructor(
    driver: ISqliteDriver,
    private readonly files: InboxFileStore
  ) {
    this.repository = new InboxRepository(driver);
    this.tasks = new TaskService(driver);
    this.calendar = new CalendarService(driver);
    this.knowledge = new KnowledgeService(driver, { read: (sourceId) => this.getKnowledgeDocument(sourceId) });
    this.notes = new NoteService(driver, this.knowledge);
  }

  captureText(input: InboxTextCaptureInput, now = Date.now()): InboxItem {
    const normalized = normalizeInboxText(input);
    return this.repository.transaction(() => {
      const item = this.repository.insertItem(newItem('text', normalized.title, now, { textContent: normalized.text }));
      this.audit('inbox_capture', { itemId: item.id, kind: item.kind }, now);
      return item;
    });
  }

  captureLink(input: InboxLinkCaptureInput, now = Date.now()): InboxItem {
    const normalized = normalizeInboxLink(input);
    return this.repository.transaction(() => {
      const item = this.repository.insertItem(newItem('link', normalized.title, now, { url: normalized.url }));
      this.audit('inbox_capture', { itemId: item.id, kind: item.kind }, now);
      return item;
    });
  }

  list(query: InboxListQuery): InboxListResult {
    return this.repository.list(query);
  }

  get(id: string): InboxItemDetail | null {
    return this.repository.getDetail(id);
  }

  getPendingSummary(limit: number): InboxPendingSummary {
    return this.repository.getPendingSummary(Math.max(0, Math.min(limit, 20)));
  }

  getPreview(id: string): InboxPreviewDescriptor {
    const detail = this.repository.getDetail(id);
    const displayName = detail?.origin?.originalName ?? detail?.item.title ?? '';
    if (!detail || detail.item.kind !== 'file' || !detail.asset) return missingPreview(displayName);
    return this.files.getPreview(detail.asset.managedName, detail.asset.mimeType, displayName);
  }

  getManagedFilePath(id: string): string {
    const detail = this.repository.getDetail(id);
    if (!detail || detail.item.kind !== 'file' || !detail.asset) throw new Error('INBOX_MANAGED_FILE_NOT_FOUND');
    const managedPath = this.files.resolveManagedPath(detail.asset.managedName);
    if (!this.files.managedFileExists(detail.asset.managedName)) throw new Error('INBOX_MANAGED_FILE_NOT_FOUND');
    return managedPath;
  }

  update(input: InboxUpdateInput, now = Date.now()): InboxItem {
    const current = this.requireActiveSource(input.id);
    let changes: Pick<InboxItem, 'title' | 'textContent' | 'url'>;
    if (current.kind === 'text') {
      const normalized = normalizeInboxText({
        text: input.textContent ?? current.textContent ?? '',
        title: input.title ?? current.title,
      });
      changes = { title: normalized.title, textContent: normalized.text, url: null };
    } else if (current.kind === 'link') {
      const normalized = normalizeInboxLink({
        url: input.url ?? current.url ?? '',
        title: input.title ?? current.title,
      });
      changes = { title: normalized.title, textContent: null, url: normalized.url };
    } else {
      const title = input.title?.trim() ?? current.title;
      if (!title) throw new Error('INBOX_TITLE_REQUIRED');
      changes = { title, textContent: null, url: null };
    }
    return this.repository.transaction(() => {
      const updated = this.repository.updateItem({ ...current, ...changes, updatedAt: now });
      this.audit('inbox_update', { itemId: updated.id, kind: updated.kind }, now);
      return updated;
    });
  }

  archive(ids: readonly string[], now = Date.now()): InboxMutationResult {
    return this.mutate('inbox_archive', ids, now, () => this.repository.archive(ids, now));
  }

  remove(ids: readonly string[], now = Date.now()): InboxMutationResult {
    return this.mutate('inbox_delete', ids, now, () => this.repository.remove(ids, now));
  }

  restore(ids: readonly string[], now = Date.now()): InboxMutationResult {
    return this.mutate('inbox_restore', ids, now, () => this.repository.restore(ids, now));
  }

  destroy(ids: readonly string[], now = Date.now()): InboxMutationResult {
    const result = this.mutate('inbox_destroy', ids, now, () => this.repository.destroy(ids));
    this.cleanupUnreferencedAssets(now);
    return result;
  }

  emptyTrash(now = Date.now()): InboxMutationResult {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = this.repository.list({ view: 'trash', limit: 100, cursor });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    if (ids.length === 0) return { affectedIds: [], affectedCount: 0 };
    const result = this.repository.transaction(() => {
      let affectedCount = 0;
      for (let offset = 0; offset < ids.length; offset += 500) {
        affectedCount += this.repository.destroy(ids.slice(offset, offset + 500)).affectedCount;
      }
      this.audit('inbox_trash_empty', { count: affectedCount }, now);
      return { affectedIds: ids, affectedCount };
    });
    this.cleanupUnreferencedAssets(now);
    return result;
  }

  async importFiles(input: InboxFileImportInput, now = Date.now()): Promise<InboxImportResult> {
    const result: InboxImportResult = { imported: [], failed: [] };
    for (const untrusted of input.files) {
      try {
        const source = normalizeInboxFileSource(untrusted);
        if (source.kind !== 'path') throw new Error('INBOX_DESKTOP_PATH_REQUIRED');
        // Keep large file copies sequential to bound disk IO and memory pressure.
        // oxlint-disable-next-line no-await-in-loop
        const managed = await this.files.importFile(source.path);
        try {
          const imported = this.repository.transaction(() => {
            const existing = this.repository.findAssetBySha256(managed.sha256);
            const asset =
              existing ??
              this.repository.insertAsset({
                id: randomUUID(),
                sha256: managed.sha256,
                managedName: managed.managedName,
                mimeType: managed.mimeType,
                sizeBytes: managed.sizeBytes,
                createdAt: now,
              });
            const origin = this.repository.insertOrigin({
              id: randomUUID(),
              assetId: asset.id,
              originalName: source.name,
              originalPath: source.originalPath ?? source.path,
              importedAt: now,
            });
            const item = this.repository.insertItem(
              newItem('file', source.name, now, { textContent: null, originId: origin.id })
            );
            this.audit(
              'inbox_import',
              { itemId: item.id, assetId: asset.id, kind: item.kind, size: asset.sizeBytes },
              now
            );
            return {
              detail: this.repository.getDetail(item.id)!,
              outcome: existing
                ? ('reused' as const)
                : managed.createdNewFile
                  ? ('created' as const)
                  : ('reused' as const),
            };
          });
          result.imported.push(imported);
        } catch (error) {
          if (managed.createdNewFile && !this.repository.findAssetBySha256(managed.sha256)) {
            this.files.removeManagedFile(managed.managedName);
          }
          throw error;
        }
      } catch (error) {
        result.failed.push({ name: untrusted.name, code: errorCode(error) });
      }
    }
    return result;
  }

  convertToTask(input: InboxTaskConversionInput, now = Date.now()): InboxConversionResult {
    const targetId = conversionTargetId(input.operationId, 'task');
    const existing = this.repository.findSourceLink('task', targetId);
    if (existing) return this.completedResult(existing.sourceId, existing, targetId);
    return this.repository.transaction(() => {
      this.requireActiveSource(input.sourceId);
      this.tasks.createFromInbox(input.target, targetId, now);
      const sourceLink = this.repository.insertSourceLink({
        id: randomUUID(),
        sourceType: 'inbox-item',
        sourceId: input.sourceId,
        targetType: 'task',
        targetId,
        createdAt: now,
      });
      const item = this.repository.markOrganized(input.sourceId, now);
      this.audit('inbox_convert', { itemId: item.id, targetId, targetType: 'task' }, now);
      return { item, sourceLink, targetId, alreadyCompleted: false };
    });
  }

  convertToEvent(input: InboxEventConversionInput, now = Date.now()): InboxConversionResult {
    const targetId = conversionTargetId(input.operationId, 'calendar-event');
    const existing = this.repository.findSourceLink('calendar-event', targetId);
    if (existing) return this.completedResult(existing.sourceId, existing, targetId);
    return this.repository.transaction(() => {
      this.requireActiveSource(input.sourceId);
      this.calendar.createEventFromInbox(input.target, targetId, now);
      const sourceLink = this.repository.insertSourceLink({
        id: randomUUID(),
        sourceType: 'inbox-item',
        sourceId: input.sourceId,
        targetType: 'calendar-event',
        targetId,
        createdAt: now,
      });
      const item = this.repository.markOrganized(input.sourceId, now);
      this.audit('inbox_convert', { itemId: item.id, targetId, targetType: 'calendar-event' }, now);
      return { item, sourceLink, targetId, alreadyCompleted: false };
    });
  }

  convertToNote(input: InboxNoteConversionInput, now = Date.now()): InboxConversionResult {
    const targetId = conversionTargetId(input.operationId, 'note');
    const existing = this.repository.findSourceLink('note', targetId);
    if (existing) return this.completedResult(existing.sourceId, existing, targetId);
    return this.repository.transaction(() => {
      const detail = this.requireActiveDetail(input.sourceId);
      this.notes.createWithId(
        {
          title: detail.item.title,
          body:
            detail.item.textContent ??
            detail.item.url ??
            (detail.origin ? `File: ${detail.origin.originalName}` : detail.item.title),
        },
        targetId,
        now
      );
      const sourceLink = this.repository.insertSourceLink({
        id: randomUUID(),
        sourceType: 'inbox-item',
        sourceId: input.sourceId,
        targetType: 'note',
        targetId,
        createdAt: now,
      });
      const item = this.repository.markOrganized(input.sourceId, now);
      this.audit('inbox_convert', { itemId: item.id, targetId, targetType: 'note' }, now);
      return { item, sourceLink, targetId, alreadyCompleted: false };
    });
  }

  convertToKnowledge(input: InboxKnowledgeConversionInput, now = Date.now()): InboxConversionResult {
    const targetId = conversionTargetId(input.operationId, 'knowledge-source');
    const existing = this.repository.findSourceLink('knowledge-source', targetId);
    if (existing) return this.completedResult(existing.sourceId, existing, targetId);
    return this.repository.transaction(() => {
      this.requireActiveSource(input.sourceId);
      const document = this.getKnowledgeDocument(input.sourceId);
      if (!document) throw new Error('KNOWLEDGE_CONTENT_UNAVAILABLE');
      this.knowledge.upsertInbox(document, targetId, now);
      const sourceLink = this.repository.insertSourceLink({
        id: randomUUID(),
        sourceType: 'inbox-item',
        sourceId: input.sourceId,
        targetType: 'knowledge-source',
        targetId,
        createdAt: now,
      });
      const item = this.repository.markOrganized(input.sourceId, now);
      this.audit('inbox_convert', { itemId: item.id, targetId, targetType: 'knowledge-source' }, now);
      return { item, sourceLink, targetId, alreadyCompleted: false };
    });
  }

  private completedResult(
    sourceId: string,
    sourceLink: InboxConversionResult['sourceLink'],
    targetId: string
  ): InboxConversionResult {
    const item = this.repository.findItemById(sourceId);
    if (!item) throw new Error('INBOX_ITEM_NOT_FOUND');
    return { item, sourceLink, targetId, alreadyCompleted: true };
  }

  private requireActiveSource(id: string): InboxItem {
    const item = this.repository.findItemById(id);
    if (!item || item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
    return item;
  }

  private requireActiveDetail(id: string): InboxItemDetail {
    const detail = this.repository.getDetail(id);
    if (!detail || detail.item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
    return detail;
  }

  getKnowledgeDocument(id: string): InboxKnowledgeDocument | null {
    const detail = this.repository.getDetail(id);
    if (!detail || detail.item.deletedAt !== null) return null;
    if (detail.item.kind === 'text' && detail.item.textContent) {
      return { sourceId: id, title: detail.item.title, contentText: detail.item.textContent };
    }
    if (detail.item.kind === 'link' && detail.item.url) {
      return { sourceId: id, title: detail.item.title, contentText: detail.item.url };
    }
    if (detail.item.kind === 'file') {
      const preview = this.getPreview(id);
      if (preview.kind === 'text' && preview.text) {
        return { sourceId: id, title: detail.item.title, contentText: preview.text };
      }
    }
    return null;
  }

  private mutate(
    action: string,
    ids: readonly string[],
    now: number,
    operation: () => InboxMutationResult
  ): InboxMutationResult {
    return this.repository.transaction(() => {
      const result = operation();
      this.audit(action, { count: result.affectedCount, itemIds: result.affectedIds }, now);
      return result;
    });
  }

  private cleanupUnreferencedAssets(now: number): void {
    for (const asset of this.repository.listUnreferencedAssets()) {
      try {
        this.files.removeManagedFile(asset.managedName);
        this.repository.deleteAsset(asset.id);
      } catch {
        this.repository.insertAudit(randomUUID(), 'inbox_managed_file_cleanup', 'failure', { assetId: asset.id }, now);
      }
    }
  }

  private audit(action: string, detail: Record<string, unknown>, now: number): void {
    this.repository.insertAudit(randomUUID(), action, 'success', detail, now);
  }
}

function newItem(
  kind: InboxItem['kind'],
  title: string,
  now: number,
  content: Partial<Pick<InboxItem, 'textContent' | 'url' | 'originId'>>
): InboxItem {
  return {
    id: randomUUID(),
    kind,
    state: 'pending',
    title,
    textContent: content.textContent ?? null,
    url: content.url ?? null,
    originId: content.originId ?? null,
    capturedAt: now,
    organizedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error) || !/^[A-Z0-9_]+$/.test(error.message)) return 'INBOX_IMPORT_FAILED';
  return error.message;
}

function missingPreview(displayName: string): InboxPreviewDescriptor {
  return {
    kind: 'missing',
    mimeType: null,
    displayName,
    url: null,
    text: null,
    truncated: false,
    canReveal: false,
    canDownload: false,
  };
}
