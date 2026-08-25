import type { CalendarEventCreateInput } from './calendar';
import type { TaskCreateInput } from './tasks';

export const INBOX_ITEM_KINDS = ['text', 'link', 'file'] as const;
export type InboxItemKind = (typeof INBOX_ITEM_KINDS)[number];

export const INBOX_ITEM_STATES = ['pending', 'organized', 'archived'] as const;
export type InboxItemState = (typeof INBOX_ITEM_STATES)[number];

export type InboxItem = {
  id: string;
  kind: InboxItemKind;
  state: InboxItemState;
  title: string;
  textContent: string | null;
  url: string | null;
  originId: string | null;
  capturedAt: number;
  organizedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type InboxAsset = {
  id: string;
  sha256: string;
  managedName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
};

export type InboxAssetOrigin = {
  id: string;
  assetId: string;
  originalName: string;
  originalPath: string | null;
  importedAt: number;
};

export const INBOX_TARGET_TYPES = ['task', 'calendar-event', 'note', 'knowledge-source'] as const;
export type InboxTargetType = (typeof INBOX_TARGET_TYPES)[number];
export type InboxConversionTargetType = InboxTargetType;

export type SourceLink = {
  id: string;
  sourceType: 'inbox-item';
  sourceId: string;
  targetType: InboxTargetType;
  targetId: string;
  createdAt: number;
};

export type InboxItemDetail = {
  item: InboxItem;
  asset: InboxAsset | null;
  origin: InboxAssetOrigin | null;
  sourceLinks: SourceLink[];
};

export type InboxListView = InboxItemState | 'trash';

export type InboxListQuery = {
  view: InboxListView;
  kinds?: InboxItemKind[];
  search?: string;
  cursor?: string | null;
  limit?: number;
};

export type InboxListResult = {
  items: InboxItem[];
  nextCursor: string | null;
  total: number;
};

export type InboxTextCaptureInput = {
  text: string;
  title?: string;
};

export type InboxLinkCaptureInput = {
  url: string;
  title?: string;
};

type InboxFileImportSourceBase = {
  name: string;
  sizeBytes: number;
  mimeType?: string;
};

export type InboxFileImportSource =
  | (InboxFileImportSourceBase & {
      kind: 'path';
      path: string;
      originalPath?: string;
      file?: never;
    })
  | (InboxFileImportSourceBase & {
      kind: 'blob';
      path?: never;
      file: Blob;
    });

export type InboxFileImportInput = {
  files: InboxFileImportSource[];
};

export type InboxImportFailure = {
  name: string;
  code: string;
};

export const INBOX_IMPORT_OUTCOMES = ['created', 'reused'] as const;
export type InboxImportOutcome = (typeof INBOX_IMPORT_OUTCOMES)[number];

export type InboxImportedFile = {
  detail: InboxItemDetail;
  outcome: InboxImportOutcome;
};

export type InboxImportResult = {
  imported: InboxImportedFile[];
  failed: InboxImportFailure[];
};

export type InboxUpdateInput = {
  id: string;
  title?: string;
  textContent?: string;
  url?: string;
};

export type InboxMutationResult = {
  affectedIds: string[];
  affectedCount: number;
};

type InboxConversionInput<TTarget> = {
  sourceId: string;
  operationId: string;
  target: TTarget;
};

export type InboxTaskConversionInput = InboxConversionInput<TaskCreateInput>;
export type InboxEventConversionInput = InboxConversionInput<CalendarEventCreateInput>;
export type InboxNoteConversionInput = Pick<InboxConversionInput<never>, 'sourceId' | 'operationId'>;
export type InboxKnowledgeConversionInput = Pick<InboxConversionInput<never>, 'sourceId' | 'operationId'>;

export type InboxConversionResult = {
  item: InboxItem;
  sourceLink: SourceLink;
  targetId: string;
  alreadyCompleted: boolean;
};

export type InboxPendingSummary = {
  count: number;
  items: InboxItem[];
};

export type InboxPreviewKind = 'image' | 'text' | 'document' | 'unsupported' | 'missing';

export type InboxPreviewDescriptor = {
  kind: InboxPreviewKind;
  mimeType: string | null;
  displayName: string;
  url: string | null;
  text: string | null;
  truncated: boolean;
  canReveal: boolean;
  canDownload: boolean;
};

export interface InboxClient {
  list(query: InboxListQuery): Promise<InboxListResult>;
  get(id: string): Promise<InboxItemDetail | null>;
  captureText(input: InboxTextCaptureInput): Promise<InboxItem>;
  captureLink(input: InboxLinkCaptureInput): Promise<InboxItem>;
  importFiles(input: InboxFileImportInput): Promise<InboxImportResult>;
  update(input: InboxUpdateInput): Promise<InboxItem>;
  archive(ids: string[]): Promise<InboxMutationResult>;
  remove(ids: string[]): Promise<InboxMutationResult>;
  restore(ids: string[]): Promise<InboxMutationResult>;
  destroy(ids: string[]): Promise<InboxMutationResult>;
  emptyTrash(): Promise<InboxMutationResult>;
  convertToTask(input: InboxTaskConversionInput): Promise<InboxConversionResult>;
  convertToEvent(input: InboxEventConversionInput): Promise<InboxConversionResult>;
  convertToNote(input: InboxNoteConversionInput): Promise<InboxConversionResult>;
  convertToKnowledge(input: InboxKnowledgeConversionInput): Promise<InboxConversionResult>;
  getPendingSummary(limit: number): Promise<InboxPendingSummary>;
  getPreview(id: string): Promise<InboxPreviewDescriptor>;
  revealManagedFile(id: string): Promise<void>;
}
