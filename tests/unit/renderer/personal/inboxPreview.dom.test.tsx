// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InboxPreviewDescriptor } from '@/common/types/searcht/inbox';
import InboxPreview from '@renderer/pages/inbox/components/InboxPreview';
import { createInboxFileSources, useInboxDrop } from '@renderer/pages/inbox/hooks/useInboxDrop';

const labels = {
  preview: 'Preview',
  truncated: 'Preview truncated',
  document: 'Document preview',
  unsupported: 'Preview unavailable for this file type',
  missing: 'Managed file is missing or damaged',
  reveal: 'Show in folder',
  download: 'Download',
  drop: 'Drop files to capture',
  directoryRejected: 'Folders cannot be imported',
};

function descriptor(changes: Partial<InboxPreviewDescriptor>): InboxPreviewDescriptor {
  return {
    kind: 'unsupported',
    mimeType: 'application/octet-stream',
    displayName: 'sample.bin',
    url: null,
    text: null,
    truncated: false,
    canReveal: false,
    canDownload: false,
    ...changes,
  };
}

describe('InboxPreview', () => {
  it('renders image and bounded text previews', () => {
    const { rerender } = render(
      <InboxPreview
        descriptor={descriptor({ kind: 'image', displayName: 'photo.png', url: 'blob:photo' })}
        labels={labels}
      />
    );
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'blob:photo');

    rerender(
      <InboxPreview
        descriptor={descriptor({ kind: 'text', displayName: 'notes.md', text: '# Notes', truncated: true })}
        labels={labels}
      />
    );
    expect(screen.getByText('# Notes')).toBeInTheDocument();
    expect(screen.getByText('Preview truncated')).toBeInTheDocument();
  });

  it('shows document, unsupported, and missing states with available actions', async () => {
    const onReveal = vi.fn();
    const onDownload = vi.fn();
    const { rerender } = render(
      <InboxPreview
        descriptor={descriptor({ kind: 'document', displayName: 'brief.pdf', canReveal: true, canDownload: true })}
        labels={labels}
        onReveal={onReveal}
        onDownload={onDownload}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledOnce();

    rerender(<InboxPreview descriptor={descriptor({ kind: 'unsupported' })} labels={labels} />);
    expect(screen.getByText('Preview unavailable for this file type')).toBeInTheDocument();

    rerender(<InboxPreview descriptor={descriptor({ kind: 'missing' })} labels={labels} />);
    expect(screen.getByText('Managed file is missing or damaged')).toBeInTheDocument();
  });
});

const DropHarness: React.FC<{
  onFiles(files: File[]): void;
  onDirectoryRejected(): void;
}> = ({ onFiles, onDirectoryRejected }) => {
  const { active, dropProps } = useInboxDrop({ onFiles, onDirectoryRejected });
  return (
    <div data-testid='drop-target' {...dropProps}>
      {active ? labels.drop : 'idle'}
    </div>
  );
};

describe('useInboxDrop', () => {
  it('builds Blob sources for WebUI and path sources for Electron', () => {
    const file = new File(['a'], 'a.txt', { type: 'text/plain' });

    expect(createInboxFileSources([file])).toEqual([expect.objectContaining({ kind: 'blob', name: 'a.txt', file })]);
    expect(createInboxFileSources([file], () => 'C:\\drop\\a.txt')).toEqual([
      expect.objectContaining({ kind: 'path', name: 'a.txt', path: 'C:\\drop\\a.txt' }),
    ]);
  });

  it('shows a restrained overlay state and forwards multiple files', () => {
    const onFiles = vi.fn();
    const first = new File(['a'], 'a.txt', { type: 'text/plain' });
    const second = new File(['b'], 'b.md', { type: 'text/markdown' });
    render(<DropHarness onFiles={onFiles} onDirectoryRejected={vi.fn()} />);

    const target = screen.getByTestId('drop-target');
    fireEvent.dragEnter(target, { dataTransfer: { files: [first, second], items: [] } });
    expect(target).toHaveTextContent(labels.drop);
    fireEvent.drop(target, { dataTransfer: { files: [first, second], items: [] } });

    expect(onFiles).toHaveBeenCalledWith([first, second]);
    expect(target).toHaveTextContent('idle');
  });

  it('rejects a directory without forwarding its files', () => {
    const onFiles = vi.fn();
    const onDirectoryRejected = vi.fn();
    const directoryItem = { webkitGetAsEntry: () => ({ isDirectory: true }) };
    render(<DropHarness onFiles={onFiles} onDirectoryRejected={onDirectoryRejected} />);

    fireEvent.drop(screen.getByTestId('drop-target'), {
      dataTransfer: { files: [], items: [directoryItem] },
    });

    expect(onDirectoryRejected).toHaveBeenCalledOnce();
    expect(onFiles).not.toHaveBeenCalled();
  });
});
