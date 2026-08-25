import { describe, expect, it } from 'vitest';
import { INBOX_IMPORT_OUTCOMES, type InboxImportResult } from '@/common/types/searcht/inbox';
import {
  INBOX_DESKTOP_MAX_FILE_BYTES,
  INBOX_WEB_MAX_FILE_BYTES,
  conversionTargetId,
  normalizeInboxBatchIds,
  normalizeInboxFileSource,
  normalizeInboxLink,
  normalizeInboxSearch,
  normalizeInboxText,
  validateInboxFileSize,
} from '@/common/searcht/inboxValidation';

describe('inbox text validation', () => {
  it('trims required content and an explicit title', () => {
    expect(normalizeInboxText({ text: '  keep this\n', title: '  My title  ' })).toEqual({
      text: 'keep this',
      title: 'My title',
    });
  });

  it('rejects content containing only whitespace with a stable code', () => {
    expect(() => normalizeInboxText({ text: ' \n\t ' })).toThrow('INBOX_TEXT_REQUIRED');
  });

  it('uses the first non-empty line as the default title and limits it to 80 characters', () => {
    const firstLine = 'x'.repeat(90);
    expect(normalizeInboxText({ text: `\n  \n${firstLine}\nsecond line` }).title).toBe('x'.repeat(80));
  });

  it('handles CR-only lines and does not split an emoji at the title boundary', () => {
    expect(normalizeInboxText({ text: '\r\rfirst\rsecond' }).title).toBe('first');
    expect(normalizeInboxText({ text: `${'x'.repeat(79)}😀tail` }).title).toBe(`${'x'.repeat(79)}😀`);
  });
});

describe('inbox link validation', () => {
  it('accepts absolute HTTP and HTTPS URLs and uses the hostname as the default title', () => {
    expect(normalizeInboxLink({ url: '  https://example.com/path?q=1  ', title: ' ' })).toEqual({
      url: 'https://example.com/path?q=1',
      title: 'example.com',
    });
    expect(normalizeInboxLink({ url: 'http://example.org' }).title).toBe('example.org');
  });

  it('rejects relative and executable protocols without echoing captured input', () => {
    for (const url of ['/relative', 'file:///C:/secret.txt', 'javascript:alert(1)']) {
      try {
        normalizeInboxLink({ url });
        throw new Error('expected validation to fail');
      } catch (error) {
        expect(error).toMatchObject({ message: 'INBOX_URL_PROTOCOL' });
        expect(String(error)).not.toContain(url);
      }
    }
  });
});

describe('inbox query validation', () => {
  it('trims search text and accepts exactly 200 characters', () => {
    expect(normalizeInboxSearch('  hello  ')).toBe('hello');
    expect(normalizeInboxSearch('x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('rejects search text longer than 200 characters', () => {
    expect(() => normalizeInboxSearch('x'.repeat(201))).toThrow('INBOX_SEARCH_TOO_LONG');
  });
});

describe('inbox batch validation', () => {
  it('accepts and copies a batch containing exactly 500 unique IDs', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `item-${index}`);
    const normalized = normalizeInboxBatchIds(ids);
    expect(normalized).toEqual(ids);
    expect(normalized).not.toBe(ids);
  });

  it('rejects an empty batch, duplicate IDs, and batches larger than 500', () => {
    expect(() => normalizeInboxBatchIds([])).toThrow('INBOX_BATCH_REQUIRED');
    expect(() => normalizeInboxBatchIds(['item-1', 'item-1'])).toThrow('INBOX_BATCH_DUPLICATE');
    expect(() => normalizeInboxBatchIds(Array.from({ length: 501 }, (_, index) => `item-${index}`))).toThrow(
      'INBOX_BATCH_TOO_LARGE'
    );
  });

  it('trims IDs before duplicate validation and returns canonical IDs', () => {
    expect(normalizeInboxBatchIds([' item-1 ', 'item-2'])).toEqual(['item-1', 'item-2']);
    expect(() => normalizeInboxBatchIds(['item-1', ' item-1 '])).toThrow('INBOX_BATCH_DUPLICATE');
  });
});

describe('inbox file source validation', () => {
  it('accepts exactly one desktop path or browser Blob source', () => {
    expect(normalizeInboxFileSource({ kind: 'path', name: 'a.txt', sizeBytes: 1, path: 'C:\\a.txt' })).toMatchObject({
      kind: 'path',
      path: 'C:\\a.txt',
    });
    expect(
      normalizeInboxFileSource({ kind: 'blob', name: 'a.txt', sizeBytes: 1, file: new Blob(['a']) })
    ).toMatchObject({
      kind: 'blob',
    });
  });

  it('rejects missing and conflicting runtime sources', () => {
    expect(() => normalizeInboxFileSource({ name: 'a.txt', sizeBytes: 1 })).toThrow('INBOX_FILE_SOURCE_REQUIRED');
    expect(() =>
      normalizeInboxFileSource({ name: 'a.txt', sizeBytes: 1, path: 'C:\\a.txt', file: new Blob(['a']) })
    ).toThrow('INBOX_FILE_SOURCE_CONFLICT');
  });
});

describe('inbox file size validation', () => {
  it('accepts empty files and the exact platform limits', () => {
    expect(validateInboxFileSize(0, 'desktop')).toBe(0);
    expect(validateInboxFileSize(INBOX_DESKTOP_MAX_FILE_BYTES, 'desktop')).toBe(INBOX_DESKTOP_MAX_FILE_BYTES);
    expect(validateInboxFileSize(INBOX_WEB_MAX_FILE_BYTES, 'web')).toBe(INBOX_WEB_MAX_FILE_BYTES);
  });

  it('rejects invalid sizes and values over each platform limit', () => {
    expect(() => validateInboxFileSize(-1, 'desktop')).toThrow('INBOX_FILE_SIZE_INVALID');
    expect(() => validateInboxFileSize(Number.NaN, 'web')).toThrow('INBOX_FILE_SIZE_INVALID');
    expect(() => validateInboxFileSize(INBOX_DESKTOP_MAX_FILE_BYTES + 1, 'desktop')).toThrow('INBOX_FILE_TOO_LARGE');
    expect(() => validateInboxFileSize(INBOX_WEB_MAX_FILE_BYTES + 1, 'web')).toThrow('INBOX_FILE_TOO_LARGE');
  });
});

describe('inbox conversion target IDs', () => {
  it('is deterministic for an operation and target type while separating target types', () => {
    const first = conversionTargetId('operation-1', 'task');
    expect(first).toBe(conversionTargetId('operation-1', 'task'));
    expect(first).not.toBe(conversionTargetId('operation-1', 'calendar-event'));
  });

  it('rejects a missing operation ID and does not embed it in the generated target ID', () => {
    expect(() => conversionTargetId('   ', 'task')).toThrow('INBOX_OPERATION_ID_REQUIRED');
    expect(conversionTargetId('private-operation-key', 'task')).not.toContain('private-operation-key');
  });
});

describe('inbox import result contract', () => {
  it('identifies whether each imported file reused managed content', () => {
    const outcome: InboxImportResult['imported'][number]['outcome'] = 'reused';

    expect(INBOX_IMPORT_OUTCOMES).toEqual(['created', 'reused']);
    expect(outcome).toBe('reused');
  });
});
