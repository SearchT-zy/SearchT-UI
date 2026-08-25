import { describe, expect, it } from 'vitest';
import {
  NOTE_BODY_MAX_LENGTH,
  NOTE_LIST_MAX_LIMIT,
  NOTE_TITLE_MAX_LENGTH,
  normalizeNoteContent,
  normalizeNoteId,
  normalizeNoteListLimit,
  normalizeNoteSearch,
} from '@/common/searcht/noteValidation';

describe('note content validation', () => {
  it('trims the title, normalizes line endings, and preserves body spacing', () => {
    expect(normalizeNoteContent({ title: '  Project brief  ', body: 'first\r\n\rsecond  ' })).toEqual({
      title: 'Project brief',
      body: 'first\n\nsecond  ',
    });
  });

  it('accepts exact title and body boundaries without splitting Unicode code points', () => {
    expect(normalizeNoteContent({ title: `${'x'.repeat(NOTE_TITLE_MAX_LENGTH - 1)}😀`, body: '' }).title).toHaveLength(
      NOTE_TITLE_MAX_LENGTH + 1
    );
    expect(normalizeNoteContent({ title: 'Title', body: 'x'.repeat(NOTE_BODY_MAX_LENGTH) }).body).toHaveLength(
      NOTE_BODY_MAX_LENGTH
    );
  });

  it('rejects blank titles and values beyond the content limits with stable codes', () => {
    expect(() => normalizeNoteContent({ title: ' \n ', body: '' })).toThrow('NOTE_TITLE_REQUIRED');
    expect(() => normalizeNoteContent({ title: 'x'.repeat(NOTE_TITLE_MAX_LENGTH + 1), body: '' })).toThrow(
      'NOTE_TITLE_TOO_LONG'
    );
    expect(() => normalizeNoteContent({ title: 'Title', body: 'x'.repeat(NOTE_BODY_MAX_LENGTH + 1) })).toThrow(
      'NOTE_BODY_TOO_LONG'
    );
  });
});

describe('note query validation', () => {
  it('canonicalizes IDs and search values', () => {
    expect(normalizeNoteId(' note-1 ')).toBe('note-1');
    expect(normalizeNoteSearch('  release plan  ')).toBe('release plan');
  });

  it('rejects missing IDs and overly long search values', () => {
    expect(() => normalizeNoteId('   ')).toThrow('NOTE_ID_REQUIRED');
    expect(() => normalizeNoteSearch('x'.repeat(201))).toThrow('NOTE_SEARCH_TOO_LONG');
  });

  it('clamps list limits to the supported range', () => {
    expect(normalizeNoteListLimit(undefined)).toBe(50);
    expect(normalizeNoteListLimit(0)).toBe(1);
    expect(normalizeNoteListLimit(NOTE_LIST_MAX_LIMIT + 10)).toBe(NOTE_LIST_MAX_LIMIT);
  });
});
