import type {
  InboxConversionTargetType,
  InboxFileImportSource,
  InboxLinkCaptureInput,
  InboxTextCaptureInput,
} from '../types/searcht/inbox';

export const INBOX_TITLE_MAX_LENGTH = 80;
export const INBOX_SEARCH_MAX_LENGTH = 200;
export const INBOX_BATCH_MAX_SIZE = 500;
export const INBOX_DESKTOP_MAX_FILE_BYTES = 500 * 1024 * 1024;
export const INBOX_WEB_MAX_FILE_BYTES = 100 * 1024 * 1024;

export class InboxValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'InboxValidationError';
    this.code = code;
  }
}

export function normalizeInboxText(input: InboxTextCaptureInput): Required<InboxTextCaptureInput> {
  const text = input.text.trim();
  if (!text) throw new InboxValidationError('INBOX_TEXT_REQUIRED');

  const explicitTitle = input.title?.trim();
  const firstNonEmptyLine = text
    .split(/\r\n?|\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  const title = Array.from(explicitTitle || firstNonEmptyLine || '')
    .slice(0, INBOX_TITLE_MAX_LENGTH)
    .join('');

  return { text, title };
}

export function normalizeInboxLink(input: InboxLinkCaptureInput): Required<InboxLinkCaptureInput> {
  const rawUrl = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InboxValidationError('INBOX_URL_PROTOCOL');
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new InboxValidationError('INBOX_URL_PROTOCOL');
  }

  return {
    url: parsed.href,
    title: input.title?.trim() || parsed.hostname,
  };
}

export function normalizeInboxSearch(search?: string): string {
  const normalized = search?.trim() ?? '';
  if (normalized.length > INBOX_SEARCH_MAX_LENGTH) {
    throw new InboxValidationError('INBOX_SEARCH_TOO_LONG');
  }
  return normalized;
}

export function normalizeInboxBatchIds(ids: readonly string[]): string[] {
  if (ids.length === 0) throw new InboxValidationError('INBOX_BATCH_REQUIRED');
  if (ids.length > INBOX_BATCH_MAX_SIZE) throw new InboxValidationError('INBOX_BATCH_TOO_LARGE');
  const normalized = ids.map((id) => id.trim());
  if (normalized.some((id) => !id)) throw new InboxValidationError('INBOX_ITEM_ID_REQUIRED');
  if (new Set(normalized).size !== normalized.length) throw new InboxValidationError('INBOX_BATCH_DUPLICATE');
  return normalized;
}

type UntrustedInboxFileSource = {
  kind?: unknown;
  name: string;
  sizeBytes: number;
  mimeType?: string;
  path?: unknown;
  originalPath?: unknown;
  file?: unknown;
};

export function normalizeInboxFileSource(input: UntrustedInboxFileSource): InboxFileImportSource {
  const hasPath = typeof input.path === 'string' && input.path.trim().length > 0;
  const hasFile = input.file instanceof Blob;
  if (hasPath && hasFile) throw new InboxValidationError('INBOX_FILE_SOURCE_CONFLICT');
  if (!hasPath && !hasFile) throw new InboxValidationError('INBOX_FILE_SOURCE_REQUIRED');

  const common = { name: input.name, sizeBytes: input.sizeBytes, mimeType: input.mimeType };
  if (hasPath) {
    const originalPath =
      typeof input.originalPath === 'string' && input.originalPath.trim() ? input.originalPath.trim() : undefined;
    if (originalPath && (originalPath.length > 32_768 || originalPath.includes('\u0000'))) {
      throw new InboxValidationError('INBOX_FILE_ORIGINAL_PATH_INVALID');
    }
    return { ...common, kind: 'path', path: (input.path as string).trim(), originalPath };
  }
  return { ...common, kind: 'blob', file: input.file as Blob };
}

export function validateInboxFileSize(sizeBytes: number, platform: 'desktop' | 'web'): number {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new InboxValidationError('INBOX_FILE_SIZE_INVALID');
  }

  const limit = platform === 'desktop' ? INBOX_DESKTOP_MAX_FILE_BYTES : INBOX_WEB_MAX_FILE_BYTES;
  if (sizeBytes > limit) throw new InboxValidationError('INBOX_FILE_TOO_LARGE');
  return sizeBytes;
}

export function conversionTargetId(operationId: string, targetType: InboxConversionTargetType): string {
  const normalizedOperationId = operationId.trim();
  if (!normalizedOperationId) throw new InboxValidationError('INBOX_OPERATION_ID_REQUIRED');

  const value = `${targetType}\0${normalizedOperationId}`;
  let high = 0xdeadbeef ^ value.length;
  let low = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 2654435761);
    low = Math.imul(low ^ code, 1597334677);
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
  const digest = (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0');

  const targetName: Record<InboxConversionTargetType, string> = {
    task: 'task',
    'calendar-event': 'event',
    note: 'note',
    'knowledge-source': 'knowledge',
  };
  return `inbox-${targetName[targetType]}-${digest}`;
}
