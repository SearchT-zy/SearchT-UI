import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import type { InboxFileImportSource } from '@/common/types/searcht/inbox';

export function createInboxFileSources(
  files: readonly File[],
  getPathForFile?: (file: File) => string
): InboxFileImportSource[] {
  return files.map((file): InboxFileImportSource => {
    const path = getPathForFile?.(file);
    if (path) return { kind: 'path', name: file.name, sizeBytes: file.size, mimeType: file.type, path };
    return { kind: 'blob', name: file.name, sizeBytes: file.size, mimeType: file.type, file };
  });
}

type Options = {
  disabled?: boolean;
  onFiles(files: File[]): void;
  onDirectoryRejected(): void;
};

function stopDropEvent(event: React.DragEvent<HTMLElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

export function useInboxDrop({ disabled = false, onFiles, onDirectoryRejected }: Options) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      stopDropEvent(event);
      if (disabled) return;
      depth.current += 1;
      setActive(true);
    },
    [disabled]
  );

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      stopDropEvent(event);
      if (!disabled) setActive(true);
    },
    [disabled]
  );

  const onDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    stopDropEvent(event);
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      stopDropEvent(event);
      depth.current = 0;
      setActive(false);
      if (disabled) return;

      const items = Array.from(event.dataTransfer?.items ?? []);
      const includesDirectory = items.some((item) => {
        const entry = item.webkitGetAsEntry?.();
        return entry?.isDirectory === true;
      });
      if (includesDirectory) {
        onDirectoryRejected();
        return;
      }

      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onDirectoryRejected, onFiles]
  );

  return { active, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
