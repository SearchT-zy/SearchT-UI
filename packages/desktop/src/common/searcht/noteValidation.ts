import type { NoteCreateInput, NoteUpdateInput } from '../types/searcht/notes';

export const NOTE_TITLE_MAX_LENGTH = 160;
export const NOTE_BODY_MAX_LENGTH = 500_000;
export const NOTE_SEARCH_MAX_LENGTH = 200;
export const NOTE_LIST_DEFAULT_LIMIT = 50;
export const NOTE_LIST_MAX_LIMIT = 100;

export class NoteValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'NoteValidationError';
    this.code = code;
  }
}

export function normalizeNoteContent(
  input: Pick<NoteCreateInput, 'title' | 'body'> | Pick<NoteUpdateInput, 'title' | 'body'>
): { title: string; body: string } {
  const title = input.title.trim();
  const body = (input.body ?? '').replace(/\r\n?/gu, '\n');
  if (!title) throw new NoteValidationError('NOTE_TITLE_REQUIRED');
  if (Array.from(title).length > NOTE_TITLE_MAX_LENGTH) throw new NoteValidationError('NOTE_TITLE_TOO_LONG');
  if (Array.from(body).length > NOTE_BODY_MAX_LENGTH) throw new NoteValidationError('NOTE_BODY_TOO_LONG');
  return { title, body };
}

export function normalizeNoteId(id: string): string {
  const normalized = id.trim();
  if (!normalized) throw new NoteValidationError('NOTE_ID_REQUIRED');
  return normalized;
}

export function normalizeNoteSearch(search?: string): string {
  const normalized = search?.trim() ?? '';
  if (Array.from(normalized).length > NOTE_SEARCH_MAX_LENGTH) throw new NoteValidationError('NOTE_SEARCH_TOO_LONG');
  return normalized;
}

export function normalizeNoteListLimit(limit?: number): number {
  if (limit === undefined) return NOTE_LIST_DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) throw new NoteValidationError('NOTE_LIST_LIMIT_INVALID');
  return Math.max(1, Math.min(Math.trunc(limit), NOTE_LIST_MAX_LIMIT));
}
