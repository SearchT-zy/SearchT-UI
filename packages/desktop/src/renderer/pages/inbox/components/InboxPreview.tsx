import React from 'react';
import { Button, Image } from '@arco-design/web-react';
import { Download, FolderOpen } from '@icon-park/react';
import type { InboxPreviewDescriptor } from '@/common/types/searcht/inbox';

export type InboxPreviewLabels = {
  preview: string;
  truncated: string;
  document: string;
  unsupported: string;
  missing: string;
  reveal: string;
  download: string;
};

type Props = {
  descriptor: InboxPreviewDescriptor;
  labels: InboxPreviewLabels;
  onReveal?(): void;
  onDownload?(): void;
};

const InboxPreview: React.FC<Props> = ({ descriptor, labels, onReveal, onDownload }) => {
  return (
    <section className='mt-16px border-t border-border-2 pt-14px' aria-label={labels.preview}>
      {descriptor.kind === 'image' && descriptor.url ? (
        <Image className='max-h-320px max-w-full object-contain' src={descriptor.url} alt={descriptor.displayName} />
      ) : null}
      {descriptor.kind === 'text' ? (
        <div>
          <pre className='m-0 max-h-320px overflow-auto whitespace-pre-wrap break-words bg-fill-1 p-12px text-12px leading-20px'>
            {descriptor.text}
          </pre>
          {descriptor.truncated ? <div className='mt-6px text-12px text-t-secondary'>{labels.truncated}</div> : null}
        </div>
      ) : null}
      {descriptor.kind === 'document' ? (
        <div className='py-18px text-center text-13px text-t-secondary'>{labels.document}</div>
      ) : null}
      {descriptor.kind === 'unsupported' ? (
        <div className='py-18px text-center text-13px text-t-secondary'>{labels.unsupported}</div>
      ) : null}
      {descriptor.kind === 'missing' ? (
        <div className='py-18px text-center text-13px text-t-secondary'>{labels.missing}</div>
      ) : null}
      {descriptor.kind !== 'missing' && (descriptor.canReveal || descriptor.canDownload) ? (
        <div className='mt-10px flex flex-wrap justify-end gap-8px'>
          {descriptor.canReveal && onReveal ? (
            <Button icon={<FolderOpen size='16' />} aria-label={labels.reveal} onClick={onReveal}>
              {labels.reveal}
            </Button>
          ) : null}
          {descriptor.canDownload && onDownload ? (
            <Button icon={<Download size='16' />} aria-label={labels.download} onClick={onDownload}>
              {labels.download}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default InboxPreview;
