import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { InboxPreviewDescriptor } from '@/common/types/searcht/inbox';
import { INBOX_DESKTOP_MAX_FILE_BYTES } from '@/common/searcht/inboxValidation';

export type ManagedFileImport = {
  sha256: string;
  managedName: string;
  sizeBytes: number;
  mimeType: string;
  createdNewFile: boolean;
};

type InboxFileStoreOptions = {
  maxFileBytes?: number;
  textPreviewBytes?: number;
  imagePreviewBytes?: number;
};

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export class InboxFileStore {
  private readonly temporaryRoot: string;
  private readonly filesRoot: string;
  private readonly maxFileBytes: number;
  private readonly textPreviewBytes: number;
  private readonly imagePreviewBytes: number;

  constructor(
    private readonly root: string,
    options: InboxFileStoreOptions = {}
  ) {
    this.temporaryRoot = path.join(root, '.tmp');
    this.filesRoot = path.join(root, 'files');
    this.maxFileBytes = options.maxFileBytes ?? INBOX_DESKTOP_MAX_FILE_BYTES;
    this.textPreviewBytes = options.textPreviewBytes ?? 128 * 1024;
    this.imagePreviewBytes = options.imagePreviewBytes ?? 20 * 1024 * 1024;
    mkdirSync(this.temporaryRoot, { recursive: true });
    mkdirSync(this.filesRoot, { recursive: true });
  }

  async importFile(sourcePath: string, signal?: AbortSignal): Promise<ManagedFileImport> {
    if (signal?.aborted) throw new Error('INBOX_IMPORT_CANCELLED');
    const stat = lstatSync(sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('INBOX_FILE_NOT_REGULAR');
    if (stat.size > this.maxFileBytes) throw new Error('INBOX_FILE_TOO_LARGE');

    const temporaryPath = path.join(this.temporaryRoot, randomUUID());
    const handle = await open(temporaryPath, 'wx');
    let handleOpen = true;
    try {
      const hash = createHash('sha256');
      let sizeBytes = 0;
      for await (const value of createReadStream(sourcePath)) {
        if (signal?.aborted) throw new Error('INBOX_IMPORT_CANCELLED');
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        sizeBytes += chunk.byteLength;
        if (sizeBytes > this.maxFileBytes) throw new Error('INBOX_FILE_TOO_LARGE');
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      if (sizeBytes !== stat.size) throw new Error('INBOX_FILE_CHANGED');
      await handle.sync();
      await handle.close();
      handleOpen = false;

      const sha256 = hash.digest('hex');
      const managedName = sha256;
      const destination = this.resolveManagedPath(managedName);
      mkdirSync(path.dirname(destination), { recursive: true });
      if (existsSync(destination)) {
        rmSync(temporaryPath, { force: true });
        return buildResult(sourcePath, sha256, sizeBytes, false);
      }

      try {
        renameSync(temporaryPath, destination);
        return buildResult(sourcePath, sha256, sizeBytes, true);
      } catch (error) {
        if (!existsSync(destination)) throw error;
        rmSync(temporaryPath, { force: true });
        return buildResult(sourcePath, sha256, sizeBytes, false);
      }
    } catch (error) {
      if (handleOpen) {
        try {
          await handle.close();
        } catch {
          // Preserve the import error; the temporary path is still cleaned below.
        }
      }
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  resolveManagedPath(managedName: string): string {
    if (!/^[a-f0-9]{64}$/.test(managedName)) throw new Error('INBOX_MANAGED_NAME_INVALID');
    const resolvedRoot = path.resolve(this.filesRoot);
    const resolved = path.resolve(resolvedRoot, managedName.slice(0, 2), managedName);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('INBOX_MANAGED_PATH_OUTSIDE_ROOT');
    return resolved;
  }

  removeManagedFile(managedName: string): void {
    rmSync(this.resolveManagedPath(managedName), { force: true });
  }

  managedFileExists(managedName: string): boolean {
    return existsSync(this.resolveManagedPath(managedName));
  }

  getPreview(managedName: string, mimeType: string, displayName: string): InboxPreviewDescriptor {
    const managedPath = this.resolveManagedPath(managedName);
    const common: Omit<InboxPreviewDescriptor, 'kind'> = {
      mimeType,
      displayName,
      url: null,
      text: null,
      truncated: false,
      canReveal: true,
      canDownload: false,
    };
    if (!existsSync(managedPath)) return { ...common, kind: 'missing', canReveal: false };

    const sizeBytes = lstatSync(managedPath).size;
    if (mimeType.startsWith('image/') && sizeBytes <= this.imagePreviewBytes) {
      const data = readFileSync(managedPath).toString('base64');
      return { ...common, kind: 'image', url: `data:${mimeType};base64,${data}` };
    }
    if (isTextMimeType(mimeType, displayName)) {
      const data = readFileSync(managedPath).subarray(0, this.textPreviewBytes);
      return { ...common, kind: 'text', text: data.toString('utf8'), truncated: sizeBytes > this.textPreviewBytes };
    }
    if (DOCUMENT_MIME_TYPES.has(mimeType)) return { ...common, kind: 'document' };
    return { ...common, kind: 'unsupported' };
  }
}

function isTextMimeType(mimeType: string, displayName: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    /\.(?:md|markdown|txt|json|csv|log)$/i.test(displayName)
  );
}

function buildResult(
  sourcePath: string,
  sha256: string,
  sizeBytes: number,
  createdNewFile: boolean
): ManagedFileImport {
  return {
    sha256,
    managedName: sha256,
    sizeBytes,
    mimeType: MIME_BY_EXTENSION[path.extname(sourcePath).toLowerCase()] ?? 'application/octet-stream',
    createdNewFile,
  };
}
