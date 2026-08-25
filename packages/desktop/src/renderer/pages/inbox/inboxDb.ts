import type {
  InboxAsset,
  InboxAssetOrigin,
  InboxConversionResult,
  InboxEventConversionInput,
  InboxFileImportInput,
  InboxImportFailure,
  InboxImportResult,
  InboxItem,
  InboxItemDetail,
  InboxKnowledgeConversionInput,
  InboxLinkCaptureInput,
  InboxListQuery,
  InboxListResult,
  InboxMutationResult,
  InboxNoteConversionInput,
  InboxPendingSummary,
  InboxPreviewDescriptor,
  InboxTextCaptureInput,
  InboxTaskConversionInput,
  InboxUpdateInput,
  SourceLink,
} from '@/common/types/searcht/inbox';
import type { CalendarEventCreateInput } from '@/common/types/searcht/calendar';
import type { KnowledgeSource } from '@/common/types/searcht/knowledge';
import type { Note, NoteRevision } from '@/common/types/searcht/notes';
import type { TaskCreateInput } from '@/common/types/searcht/tasks';
import {
  InboxValidationError,
  normalizeInboxBatchIds,
  normalizeInboxFileSource,
  normalizeInboxLink,
  normalizeInboxSearch,
  normalizeInboxText,
  validateInboxFileSize,
  conversionTargetId,
} from '@/common/searcht/inboxValidation';
import {
  openPersonalWebDatabase,
  PERSONAL_WEB_DATABASE_NAME,
  PERSONAL_WEB_DATABASE_VERSION,
  PERSONAL_WEB_STORE_NAMES,
  requestResult,
  transactionDone,
} from '../personal/personalDbSchema';

export const INBOX_DATABASE_NAME = PERSONAL_WEB_DATABASE_NAME;
export const INBOX_DATABASE_VERSION = PERSONAL_WEB_DATABASE_VERSION;

const STORE_NAMES = {
  assets: PERSONAL_WEB_STORE_NAMES.assets,
  origins: PERSONAL_WEB_STORE_NAMES.origins,
  items: PERSONAL_WEB_STORE_NAMES.items,
  links: PERSONAL_WEB_STORE_NAMES.links,
  operations: PERSONAL_WEB_STORE_NAMES.operations,
  notes: PERSONAL_WEB_STORE_NAMES.notes,
  revisions: PERSONAL_WEB_STORE_NAMES.revisions,
  knowledge: PERSONAL_WEB_STORE_NAMES.knowledge,
} as const;

type StoredInboxAsset = InboxAsset & { blob: Blob };
type PreparedFile = { name: string; mimeType: string; sizeBytes: number; blob: Blob; sha256: string };

const TEXT_PREVIEW_BYTES = 128 * 1024;
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export type InboxConversionOperationStatus = 'prepared' | 'completed' | 'compensating';
type ConversionOperationBase = {
  id: string;
  sourceId: string;
  targetId: string;
  status: InboxConversionOperationStatus;
  previousItem: InboxItem;
  createdAt: number;
  updatedAt: number;
};
export type InboxConversionOperation = ConversionOperationBase &
  (
    | { targetType: 'task'; target: TaskCreateInput }
    | { targetType: 'calendar-event'; target: CalendarEventCreateInput }
  );
export type InboxConversionPreparation =
  | (InboxTaskConversionInput & { targetType: 'task' })
  | (InboxEventConversionInput & { targetType: 'calendar-event' });

export type OpenInboxDatabaseOptions = {
  name?: string;
  factory?: IDBFactory;
  now?: () => number;
  randomUUID?: () => string;
  crypto?: Pick<Crypto, 'subtle'>;
};

export class InboxDatabase {
  constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => number,
    private readonly randomUUID: () => string,
    private readonly cryptoProvider: Pick<Crypto, 'subtle'>
  ) {}

  close(): void {
    this.database.close();
  }

  async captureText(input: InboxTextCaptureInput): Promise<InboxItem> {
    const normalized = normalizeInboxText(input);
    const item = this.newItem('text', normalized.title, { textContent: normalized.text });
    await this.write([STORE_NAMES.items], (transaction) => {
      transaction.objectStore(STORE_NAMES.items).put(item);
    });
    return item;
  }

  async captureLink(input: InboxLinkCaptureInput): Promise<InboxItem> {
    const normalized = normalizeInboxLink(input);
    const item = this.newItem('link', normalized.title, { url: normalized.url });
    await this.write([STORE_NAMES.items], (transaction) => {
      transaction.objectStore(STORE_NAMES.items).put(item);
    });
    return item;
  }

  async importFiles(input: InboxFileImportInput): Promise<InboxImportResult> {
    const failed: InboxImportFailure[] = [];
    const preparation = await Promise.all(
      input.files.map(async (untrusted): Promise<PreparedFile | InboxImportFailure> => {
        try {
          const source = normalizeInboxFileSource(untrusted);
          if (source.kind !== 'blob') throw new InboxValidationError('INBOX_FILE_SOURCE_REQUIRED');
          validateInboxFileSize(source.sizeBytes, 'web');
          if (source.file.size !== source.sizeBytes) throw new InboxValidationError('INBOX_FILE_SIZE_INVALID');
          const bytes = await readBlob(source.file);
          const digest = await this.cryptoProvider.subtle.digest('SHA-256', bytes);
          return {
            name: source.name,
            mimeType: source.mimeType?.trim() || source.file.type || 'application/octet-stream',
            sizeBytes: source.sizeBytes,
            blob: source.file,
            sha256: toHex(digest),
          };
        } catch (error) {
          return { name: untrusted.name, code: importErrorCode(error) };
        }
      })
    );
    const prepared = preparation.filter((result): result is PreparedFile => 'sha256' in result);
    failed.push(...preparation.filter((result): result is InboxImportFailure => 'code' in result));

    if (prepared.length === 0) return { imported: [], failed };

    const imported = await this.write(
      [STORE_NAMES.assets, STORE_NAMES.origins, STORE_NAMES.items],
      async (transaction) => {
        const assets = transaction.objectStore(STORE_NAMES.assets);
        const origins = transaction.objectStore(STORE_NAMES.origins);
        const items = transaction.objectStore(STORE_NAMES.items);
        const results: InboxImportResult['imported'] = [];
        const uniqueFiles = new Map(prepared.map((file) => [file.sha256, file]));
        const existingAssets = await Promise.all(
          Array.from(
            uniqueFiles.keys(),
            async (sha256) =>
              [sha256, await requestResult<StoredInboxAsset | undefined>(assets.index('sha256').get(sha256))] as const
          )
        );
        const assetsByHash = new Map(existingAssets);

        for (const [sha256, file] of uniqueFiles) {
          if (assetsByHash.get(sha256)) continue;
          const asset: StoredInboxAsset = {
            id: this.randomUUID(),
            sha256,
            managedName: sha256,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            createdAt: this.now(),
            blob: file.blob,
          };
          assets.put(asset);
          assetsByHash.set(sha256, asset);
        }

        for (const file of prepared) {
          const asset = assetsByHash.get(file.sha256)!;
          const outcome = existingAssets.some(([sha256, existing]) => sha256 === file.sha256 && existing)
            ? 'reused'
            : 'created';

          const timestamp = this.now();
          const origin: InboxAssetOrigin = {
            id: this.randomUUID(),
            assetId: asset.id,
            originalName: file.name,
            originalPath: null,
            importedAt: timestamp,
          };
          const item = this.newItem('file', truncateTitle(file.name), { originId: origin.id }, timestamp);
          origins.put(origin);
          items.put(item);
          results.push({
            outcome,
            detail: { item, asset: publicAsset(asset), origin, sourceLinks: [] },
          });
        }
        return results;
      }
    );

    return { imported, failed };
  }

  async list(query: InboxListQuery): Promise<InboxListResult> {
    const search = normalizeInboxSearch(query.search).toLocaleLowerCase();
    const limit = Math.max(1, Math.min(query.limit ?? 50, 100));
    const cursor = decodeCursor(query.cursor);
    const transaction = this.database.transaction([STORE_NAMES.items, STORE_NAMES.origins], 'readonly');
    const done = transactionDone(transaction);
    const [allItems, allOrigins] = await Promise.all([
      requestResult<InboxItem[]>(transaction.objectStore(STORE_NAMES.items).getAll()),
      requestResult<InboxAssetOrigin[]>(transaction.objectStore(STORE_NAMES.origins).getAll()),
    ]);
    await done;
    const originNames = new Map(allOrigins.map((origin) => [origin.id, origin.originalName.toLocaleLowerCase()]));
    const filtered = allItems
      .filter((item) =>
        query.view === 'trash' ? item.deletedAt !== null : item.deletedAt === null && item.state === query.view
      )
      .filter((item) => !query.kinds?.length || query.kinds.includes(item.kind))
      .filter(
        (item) =>
          !search ||
          item.title.toLocaleLowerCase().includes(search) ||
          item.textContent?.toLocaleLowerCase().includes(search) ||
          item.url?.toLocaleLowerCase().includes(search) ||
          (item.originId ? originNames.get(item.originId)?.includes(search) : false)
      )
      .toSorted(compareItems);
    const paged = cursor
      ? filtered.filter(
          (item) =>
            item.capturedAt < cursor.capturedAt || (item.capturedAt === cursor.capturedAt && item.id < cursor.id)
        )
      : filtered;
    const items = paged.slice(0, limit);
    return {
      items,
      total: filtered.length,
      nextCursor: paged.length > limit && items.length ? encodeCursor(items[items.length - 1]) : null,
    };
  }

  async get(id: string): Promise<InboxItemDetail | null> {
    const transaction = this.database.transaction(
      [STORE_NAMES.items, STORE_NAMES.origins, STORE_NAMES.assets, STORE_NAMES.links],
      'readonly'
    );
    const done = transactionDone(transaction);
    const item = await requestResult<InboxItem | undefined>(transaction.objectStore(STORE_NAMES.items).get(id));
    if (!item) {
      await done;
      return null;
    }
    const origin = item.originId
      ? ((await requestResult<InboxAssetOrigin | undefined>(
          transaction.objectStore(STORE_NAMES.origins).get(item.originId)
        )) ?? null)
      : null;
    const asset = origin
      ? ((await requestResult<StoredInboxAsset | undefined>(
          transaction.objectStore(STORE_NAMES.assets).get(origin.assetId)
        )) ?? null)
      : null;
    const sourceLinks = await requestResult<SourceLink[]>(
      transaction.objectStore(STORE_NAMES.links).index('sourceId').getAll(id)
    );
    await done;
    return { item, origin, asset: asset ? publicAsset(asset) : null, sourceLinks: sourceLinks.toSorted(compareLinks) };
  }

  async getPreview(id: string): Promise<InboxPreviewDescriptor> {
    const detail = await this.get(id);
    const displayName = detail?.origin?.originalName ?? detail?.item.title ?? '';
    if (!detail || detail.item.kind !== 'file' || !detail.origin || !detail.asset) {
      return missingPreview(displayName);
    }

    const transaction = this.database.transaction(STORE_NAMES.assets, 'readonly');
    const done = transactionDone(transaction);
    const stored = await requestResult<StoredInboxAsset | undefined>(
      transaction.objectStore(STORE_NAMES.assets).get(detail.asset.id)
    );
    await done;
    if (!stored?.blob || typeof URL.createObjectURL !== 'function') return missingPreview(displayName);

    const url = URL.createObjectURL(stored.blob);
    const common = {
      mimeType: stored.mimeType,
      displayName,
      url,
      truncated: false,
      canReveal: false,
      canDownload: true,
    };
    if (stored.mimeType.startsWith('image/')) return { ...common, kind: 'image', text: null };
    if (isTextMimeType(stored.mimeType, displayName)) {
      const truncated = stored.blob.size > TEXT_PREVIEW_BYTES;
      const text = await stored.blob.slice(0, TEXT_PREVIEW_BYTES).text();
      return { ...common, kind: 'text', text, truncated };
    }
    if (DOCUMENT_MIME_TYPES.has(stored.mimeType)) return { ...common, kind: 'document', text: null };
    return { ...common, kind: 'unsupported', text: null };
  }

  async update(input: InboxUpdateInput): Promise<InboxItem> {
    return this.write([STORE_NAMES.items], async (transaction) => {
      const store = transaction.objectStore(STORE_NAMES.items);
      const current = await requestResult<InboxItem | undefined>(store.get(input.id));
      if (!current) throw new Error('INBOX_ITEM_NOT_FOUND');
      let title = input.title === undefined ? current.title : truncateTitle(input.title.trim());
      let textContent = current.textContent;
      let url = current.url;
      if (current.kind === 'text' && input.textContent !== undefined) {
        const normalized = normalizeInboxText({ text: input.textContent, title });
        textContent = normalized.text;
        title = normalized.title;
      }
      if (current.kind === 'link' && input.url !== undefined) {
        const normalized = normalizeInboxLink({ url: input.url, title });
        url = normalized.url;
        title = normalized.title;
      }
      const updated = { ...current, title, textContent, url, updatedAt: this.now() };
      store.put(updated);
      return updated;
    });
  }

  archive(ids: string[]): Promise<InboxMutationResult> {
    const now = this.now();
    return this.mutateItems(ids, (item) => ({ ...item, state: 'archived', archivedAt: now, updatedAt: now }));
  }

  remove(ids: string[]): Promise<InboxMutationResult> {
    const now = this.now();
    return this.mutateItems(ids, (item) => ({ ...item, deletedAt: now, updatedAt: now }));
  }

  restore(ids: string[]): Promise<InboxMutationResult> {
    const now = this.now();
    return this.mutateItems(ids, (item) => ({ ...item, deletedAt: null, updatedAt: now }));
  }

  async destroy(ids: string[]): Promise<InboxMutationResult> {
    const normalized = normalizeInboxBatchIds(ids);
    return this.destroyItems(normalized);
  }

  async emptyTrash(): Promise<InboxMutationResult> {
    const transaction = this.database.transaction(STORE_NAMES.items, 'readonly');
    const done = transactionDone(transaction);
    const items = await requestResult<InboxItem[]>(transaction.objectStore(STORE_NAMES.items).getAll());
    await done;
    const ids = items.filter((item) => item.deletedAt !== null).map((item) => item.id);
    return ids.length ? this.destroyItems(ids) : { affectedIds: [], affectedCount: 0 };
  }

  async getPendingSummary(limit: number): Promise<InboxPendingSummary> {
    const result = await this.list({ view: 'pending', limit: Math.max(1, limit) });
    return { count: result.total, items: limit <= 0 ? [] : result.items.slice(0, limit) };
  }

  async convertToNote(input: InboxNoteConversionInput): Promise<InboxConversionResult> {
    const detail = await this.get(input.sourceId);
    if (!detail || detail.item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
    const targetId = conversionTargetId(input.operationId, 'note');
    const body =
      detail.item.textContent ??
      detail.item.url ??
      (detail.origin ? `File: ${detail.origin.originalName}` : detail.item.title);
    const timestamp = this.now();
    const note: Note = {
      id: targetId,
      title: detail.item.title,
      body,
      revisionNumber: 1,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    const revision: NoteRevision = {
      id: this.randomUUID(),
      noteId: targetId,
      revisionNumber: 1,
      title: note.title,
      body: note.body,
      createdAt: timestamp,
    };
    const projection: KnowledgeSource = {
      id: `knowledge-note-${targetId}`,
      sourceType: 'note',
      sourceId: targetId,
      title: note.title,
      contentText: note.body,
      contentHash: await this.contentDigest(note.title, note.body),
      indexedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.write(
      [STORE_NAMES.items, STORE_NAMES.links, STORE_NAMES.notes, STORE_NAMES.revisions, STORE_NAMES.knowledge],
      async (transaction) => {
        const items = transaction.objectStore(STORE_NAMES.items);
        const links = transaction.objectStore(STORE_NAMES.links);
        const item = await requestResult<InboxItem | undefined>(items.get(input.sourceId));
        if (!item || item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
        const existing = await requestResult<SourceLink | undefined>(links.index('target').get(['note', targetId]));
        if (existing) return { item, sourceLink: existing, targetId, alreadyCompleted: true };
        const sourceLink: SourceLink = {
          id: this.randomUUID(),
          sourceType: 'inbox-item',
          sourceId: input.sourceId,
          targetType: 'note',
          targetId,
          createdAt: timestamp,
        };
        transaction.objectStore(STORE_NAMES.notes).put(note);
        transaction.objectStore(STORE_NAMES.revisions).put(revision);
        transaction.objectStore(STORE_NAMES.knowledge).put(projection);
        links.put(sourceLink);
        const organized = { ...item, state: 'organized' as const, organizedAt: timestamp, updatedAt: timestamp };
        items.put(organized);
        return { item: organized, sourceLink, targetId, alreadyCompleted: false };
      }
    );
  }

  async convertToKnowledge(input: InboxKnowledgeConversionInput): Promise<InboxConversionResult> {
    const detail = await this.get(input.sourceId);
    if (!detail || detail.item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
    const targetId = conversionTargetId(input.operationId, 'knowledge-source');
    let contentText = detail.item.textContent ?? detail.item.url;
    if (!contentText && detail.item.kind === 'file') {
      const preview = await this.getPreview(input.sourceId);
      contentText = preview.kind === 'text' ? preview.text : null;
    }
    if (!contentText) throw new Error('KNOWLEDGE_CONTENT_UNAVAILABLE');
    const timestamp = this.now();
    const source: KnowledgeSource = {
      id: targetId,
      sourceType: 'inbox-item',
      sourceId: input.sourceId,
      title: detail.item.title,
      contentText,
      contentHash: await this.contentDigest(detail.item.title, contentText),
      indexedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.write([STORE_NAMES.items, STORE_NAMES.links, STORE_NAMES.knowledge], async (transaction) => {
      const items = transaction.objectStore(STORE_NAMES.items);
      const links = transaction.objectStore(STORE_NAMES.links);
      const item = await requestResult<InboxItem | undefined>(items.get(input.sourceId));
      if (!item || item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
      const existing = await requestResult<SourceLink | undefined>(
        links.index('target').get(['knowledge-source', targetId])
      );
      if (existing) return { item, sourceLink: existing, targetId, alreadyCompleted: true };
      const sourceLink: SourceLink = {
        id: this.randomUUID(),
        sourceType: 'inbox-item',
        sourceId: input.sourceId,
        targetType: 'knowledge-source',
        targetId,
        createdAt: timestamp,
      };
      transaction.objectStore(STORE_NAMES.knowledge).put(source);
      links.put(sourceLink);
      const organized = { ...item, state: 'organized' as const, organizedAt: timestamp, updatedAt: timestamp };
      items.put(organized);
      return { item: organized, sourceLink, targetId, alreadyCompleted: false };
    });
  }

  async prepareConversion(input: InboxConversionPreparation): Promise<InboxConversionOperation> {
    return this.write([STORE_NAMES.items, STORE_NAMES.operations], async (transaction) => {
      const operations = transaction.objectStore(STORE_NAMES.operations);
      const existing = await requestResult<InboxConversionOperation | undefined>(operations.get(input.operationId));
      if (existing) {
        if (
          existing.sourceId !== input.sourceId ||
          existing.targetType !== input.targetType ||
          JSON.stringify(existing.target) !== JSON.stringify(input.target)
        ) {
          throw new Error('INBOX_OPERATION_CONFLICT');
        }
        return existing;
      }
      const item = await requestResult<InboxItem | undefined>(
        transaction.objectStore(STORE_NAMES.items).get(input.sourceId)
      );
      if (!item || item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
      const timestamp = this.now();
      const common: ConversionOperationBase = {
        id: input.operationId,
        sourceId: input.sourceId,
        targetId: conversionTargetId(input.operationId, input.targetType),
        status: 'prepared',
        previousItem: item,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const operation: InboxConversionOperation =
        input.targetType === 'task'
          ? { ...common, targetType: 'task', target: input.target }
          : { ...common, targetType: 'calendar-event', target: input.target };
      operations.put(operation);
      return operation;
    });
  }

  async getConversionOperation(id: string): Promise<InboxConversionOperation | null> {
    const transaction = this.database.transaction(STORE_NAMES.operations, 'readonly');
    const done = transactionDone(transaction);
    const operation = await requestResult<InboxConversionOperation | undefined>(
      transaction.objectStore(STORE_NAMES.operations).get(id)
    );
    await done;
    return operation ?? null;
  }

  async listIncompleteConversions(): Promise<InboxConversionOperation[]> {
    const transaction = this.database.transaction(STORE_NAMES.operations, 'readonly');
    const done = transactionDone(transaction);
    const operations = await requestResult<InboxConversionOperation[]>(
      transaction.objectStore(STORE_NAMES.operations).getAll()
    );
    await done;
    return operations.filter((operation) => operation.status !== 'completed').toSorted(compareOperations);
  }

  async completeConversion(id: string): Promise<InboxConversionResult> {
    return this.write([STORE_NAMES.items, STORE_NAMES.links, STORE_NAMES.operations], async (transaction) => {
      const operations = transaction.objectStore(STORE_NAMES.operations);
      const operation = await requestResult<InboxConversionOperation | undefined>(operations.get(id));
      if (!operation) throw new Error('INBOX_OPERATION_NOT_FOUND');
      const items = transaction.objectStore(STORE_NAMES.items);
      const links = transaction.objectStore(STORE_NAMES.links);
      const item = await requestResult<InboxItem | undefined>(items.get(operation.sourceId));
      if (!item || item.deletedAt !== null) throw new Error('INBOX_ITEM_NOT_FOUND');
      const existingLink = await requestResult<SourceLink | undefined>(
        links.index('target').get([operation.targetType, operation.targetId])
      );
      if (operation.status === 'completed') {
        if (!existingLink) throw new Error('INBOX_OPERATION_CORRUPT');
        return { item, sourceLink: existingLink, targetId: operation.targetId, alreadyCompleted: true };
      }
      if (operation.status !== 'prepared') throw new Error('INBOX_OPERATION_COMPENSATING');
      const timestamp = this.now();
      const sourceLink: SourceLink = existingLink ?? {
        id: this.randomUUID(),
        sourceType: 'inbox-item',
        sourceId: operation.sourceId,
        targetType: operation.targetType,
        targetId: operation.targetId,
        createdAt: timestamp,
      };
      links.put(sourceLink);
      const organized = { ...item, state: 'organized' as const, organizedAt: timestamp, updatedAt: timestamp };
      items.put(organized);
      operations.put({ ...operation, status: 'completed', updatedAt: timestamp });
      return { item: organized, sourceLink, targetId: operation.targetId, alreadyCompleted: false };
    });
  }

  async markConversionCompensating(id: string): Promise<InboxConversionOperation> {
    return this.write([STORE_NAMES.operations], async (transaction) => {
      const store = transaction.objectStore(STORE_NAMES.operations);
      const operation = await requestResult<InboxConversionOperation | undefined>(store.get(id));
      if (!operation) throw new Error('INBOX_OPERATION_NOT_FOUND');
      const updated = { ...operation, status: 'compensating' as const, updatedAt: this.now() };
      store.put(updated);
      return updated;
    });
  }

  async finishConversionCompensation(id: string): Promise<void> {
    await this.write([STORE_NAMES.items, STORE_NAMES.operations], async (transaction) => {
      const operations = transaction.objectStore(STORE_NAMES.operations);
      const operation = await requestResult<InboxConversionOperation | undefined>(operations.get(id));
      if (!operation) return;
      if (operation.status !== 'compensating') throw new Error('INBOX_OPERATION_NOT_COMPENSATING');
      transaction.objectStore(STORE_NAMES.items).put(operation.previousItem);
      operations.delete(id);
    });
  }

  async pruneCompletedConversions(before: number): Promise<number> {
    return this.write([STORE_NAMES.operations], async (transaction) => {
      const store = transaction.objectStore(STORE_NAMES.operations);
      const operations = await requestResult<InboxConversionOperation[]>(store.getAll());
      const expired = operations.filter(
        (operation) => operation.status === 'completed' && operation.updatedAt < before
      );
      expired.forEach((operation) => store.delete(operation.id));
      return expired.length;
    });
  }

  private newItem(
    kind: InboxItem['kind'],
    title: string,
    content: Partial<Pick<InboxItem, 'textContent' | 'url' | 'originId'>>,
    timestamp = this.now()
  ): InboxItem {
    return {
      id: this.randomUUID(),
      kind,
      state: 'pending',
      title,
      textContent: content.textContent ?? null,
      url: content.url ?? null,
      originId: content.originId ?? null,
      capturedAt: timestamp,
      organizedAt: null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
  }

  private async contentDigest(title: string, contentText: string): Promise<string> {
    const bytes = new TextEncoder().encode(`${title}\0${contentText}`);
    return toHex(await this.cryptoProvider.subtle.digest('SHA-256', bytes));
  }

  private mutateItems(ids: string[], update: (item: InboxItem) => InboxItem): Promise<InboxMutationResult> {
    const normalized = normalizeInboxBatchIds(ids);
    return this.write([STORE_NAMES.items], async (transaction) => {
      const store = transaction.objectStore(STORE_NAMES.items);
      const items = await Promise.all(normalized.map((id) => requestResult<InboxItem | undefined>(store.get(id))));
      if (items.some((item) => !item)) throw new Error('INBOX_ITEM_NOT_FOUND');
      items.forEach((item) => store.put(update(item!)));
      return { affectedIds: normalized, affectedCount: normalized.length };
    });
  }

  private destroyItems(ids: string[]): Promise<InboxMutationResult> {
    return this.write(
      [STORE_NAMES.items, STORE_NAMES.origins, STORE_NAMES.assets, STORE_NAMES.links],
      async (transaction) => {
        const itemsStore = transaction.objectStore(STORE_NAMES.items);
        const originsStore = transaction.objectStore(STORE_NAMES.origins);
        const assetsStore = transaction.objectStore(STORE_NAMES.assets);
        const linksStore = transaction.objectStore(STORE_NAMES.links);
        const [allItems, allOrigins, allLinks] = await Promise.all([
          requestResult<InboxItem[]>(itemsStore.getAll()),
          requestResult<InboxAssetOrigin[]>(originsStore.getAll()),
          requestResult<SourceLink[]>(linksStore.getAll()),
        ]);
        const removedIds = new Set(ids);
        const removedItems = allItems.filter((item) => removedIds.has(item.id));
        if (removedItems.length !== ids.length) throw new Error('INBOX_ITEM_NOT_FOUND');
        const remainingItems = allItems.filter((item) => !removedIds.has(item.id));
        const candidateOriginIds = new Set(removedItems.flatMap((item) => (item.originId ? [item.originId] : [])));
        const deletedOrigins = allOrigins.filter(
          (origin) => candidateOriginIds.has(origin.id) && !remainingItems.some((item) => item.originId === origin.id)
        );
        const deletedOriginIds = new Set(deletedOrigins.map((origin) => origin.id));
        const remainingOrigins = allOrigins.filter((origin) => !deletedOriginIds.has(origin.id));

        allLinks.filter((link) => removedIds.has(link.sourceId)).forEach((link) => linksStore.delete(link.id));
        ids.forEach((id) => itemsStore.delete(id));
        deletedOrigins.forEach((origin) => originsStore.delete(origin.id));
        new Set(deletedOrigins.map((origin) => origin.assetId)).forEach((assetId) => {
          if (!remainingOrigins.some((origin) => origin.assetId === assetId)) assetsStore.delete(assetId);
        });
        return { affectedIds: ids, affectedCount: ids.length };
      }
    );
  }

  private async write<T>(stores: string[], operation: (transaction: IDBTransaction) => T | Promise<T>): Promise<T> {
    const transaction = this.database.transaction(stores, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const result = await operation(transaction);
      await done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have aborted because of the failed request.
      }
      await done.catch((): undefined => undefined);
      throw error;
    }
  }
}

export async function openInboxDatabase(options: OpenInboxDatabaseOptions = {}): Promise<InboxDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('INBOX_INDEXEDDB_UNAVAILABLE');
  const cryptoProvider = options.crypto ?? globalThis.crypto;
  if (!cryptoProvider?.subtle) throw new Error('INBOX_CRYPTO_UNAVAILABLE');
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const database = await openPersonalWebDatabase(factory, options.name ?? INBOX_DATABASE_NAME);
  return new InboxDatabase(database, options.now ?? Date.now, randomUUID, cryptoProvider);
}

async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function publicAsset(asset: StoredInboxAsset): InboxAsset {
  const { blob: _blob, ...metadata } = asset;
  return metadata;
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

function isTextMimeType(mimeType: string, displayName: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    /\.(?:md|markdown|txt|json|csv|log)$/i.test(displayName)
  );
}

function truncateTitle(value: string): string {
  return Array.from(value.trim()).slice(0, 80).join('');
}

function importErrorCode(error: unknown): string {
  if (error instanceof InboxValidationError) return error.code;
  return 'INBOX_IMPORT_FAILED';
}

function compareItems(left: InboxItem, right: InboxItem): number {
  return right.capturedAt - left.capturedAt || right.id.localeCompare(left.id);
}

function compareLinks(left: SourceLink, right: SourceLink): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function compareOperations(left: InboxConversionOperation, right: InboxConversionOperation): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function encodeCursor(item: InboxItem): string {
  return JSON.stringify([item.capturedAt, item.id]);
}

function decodeCursor(cursor?: string | null): { capturedAt: number; id: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(cursor) as unknown;
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !Number.isSafeInteger(value[0]) ||
      typeof value[1] !== 'string'
    ) {
      throw new Error();
    }
    return { capturedAt: value[0] as number, id: value[1] };
  } catch {
    throw new InboxValidationError('INBOX_CURSOR_INVALID');
  }
}
