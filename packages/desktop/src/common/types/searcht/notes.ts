export const NOTE_VIEWS = ['active', 'archived', 'trash'] as const;
export type NoteView = (typeof NOTE_VIEWS)[number];

export type Note = {
  id: string;
  title: string;
  body: string;
  revisionNumber: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type NoteRevision = {
  id: string;
  noteId: string;
  revisionNumber: number;
  title: string;
  body: string;
  createdAt: number;
};

export type NoteSourceReference = {
  id: string;
  sourceType: 'inbox-item';
  sourceId: string;
  createdAt: number;
};

export type NoteDetail = {
  note: Note;
  sourceReferences: NoteSourceReference[];
};

export type NoteListQuery = {
  view: NoteView;
  search?: string;
  cursor?: string | null;
  limit?: number;
};

export type NoteListResult = {
  notes: Note[];
  total: number;
  nextCursor: string | null;
};

export type NoteCreateInput = {
  title: string;
  body?: string;
};

export type NoteUpdateInput = {
  id: string;
  title: string;
  body: string;
};

export type NoteMutationResult = {
  affectedIds: string[];
  affectedCount: number;
};

export type NoteRevisionListQuery = {
  noteId: string;
  cursor?: number | null;
  limit?: number;
};

export type NoteRevisionListResult = {
  revisions: NoteRevision[];
  nextCursor: number | null;
};

export type NoteRevisionRestoreInput = {
  noteId: string;
  revisionId: string;
};

export interface NoteClient {
  list(query: NoteListQuery): Promise<NoteListResult>;
  get(id: string): Promise<NoteDetail | null>;
  create(input: NoteCreateInput): Promise<NoteDetail>;
  update(input: NoteUpdateInput): Promise<NoteDetail>;
  archive(ids: string[]): Promise<NoteMutationResult>;
  unarchive(ids: string[]): Promise<NoteMutationResult>;
  remove(ids: string[]): Promise<NoteMutationResult>;
  restore(ids: string[]): Promise<NoteMutationResult>;
  destroy(ids: string[]): Promise<NoteMutationResult>;
  emptyTrash(): Promise<NoteMutationResult>;
  listRevisions(query: NoteRevisionListQuery): Promise<NoteRevisionListResult>;
  restoreRevision(input: NoteRevisionRestoreInput): Promise<NoteDetail>;
}
