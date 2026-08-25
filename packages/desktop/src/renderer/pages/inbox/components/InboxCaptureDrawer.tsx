import React, { useEffect, useState } from 'react';
import { Button, Drawer, Input, Tabs } from '@arco-design/web-react';

type Props = {
  visible: boolean;
  saving: boolean;
  labels: {
    title: string;
    text: string;
    link: string;
    files: string;
    content: string;
    url: string;
    optionalTitle: string;
    saveText: string;
    saveLink: string;
    addFiles: string;
  };
  onClose(): void;
  onText(input: { text: string; title?: string }): Promise<boolean>;
  onLink(input: { url: string; title?: string }): Promise<boolean>;
  onFiles(files: File[]): Promise<boolean>;
};

const InboxCaptureDrawer: React.FC<Props> = ({ visible, saving, labels, onClose, onText, onLink, onFiles }) => {
  const [mode, setMode] = useState<'text' | 'link' | 'files'>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!visible) {
      setTitle('');
      setContent('');
      setUrl('');
      setMode('text');
    }
  }, [visible]);

  const finish = (saved: boolean) => {
    if (saved) onClose();
  };

  return (
    <Drawer width={440} visible={visible} title={labels.title} footer={null} onCancel={onClose} unmountOnExit>
      <Tabs activeTab={mode} onChange={(value) => setMode(value as typeof mode)}>
        <Tabs.TabPane key='text' title={labels.text} />
        <Tabs.TabPane key='link' title={labels.link} />
        <Tabs.TabPane key='files' title={labels.files} />
      </Tabs>
      {mode !== 'files' ? (
        <div className='mt-16px block text-12px text-t-secondary'>
          {labels.optionalTitle}
          <Input className='mt-6px' value={title} onChange={setTitle} />
        </div>
      ) : null}
      {mode === 'text' ? (
        <>
          <div className='mt-14px block text-12px text-t-secondary'>
            {labels.content}
            <Input.TextArea
              className='mt-6px'
              aria-label={labels.content}
              autoSize={{ minRows: 7, maxRows: 14 }}
              value={content}
              onChange={setContent}
            />
          </div>
          <Button
            className='mt-18px w-full'
            type='primary'
            loading={saving}
            disabled={!content.trim()}
            onClick={() => void onText({ text: content, title: title.trim() || undefined }).then(finish)}
          >
            {labels.saveText}
          </Button>
        </>
      ) : null}
      {mode === 'link' ? (
        <>
          <div className='mt-14px block text-12px text-t-secondary'>
            {labels.url}
            <Input className='mt-6px' aria-label={labels.url} value={url} onChange={setUrl} />
          </div>
          <Button
            className='mt-18px w-full'
            type='primary'
            loading={saving}
            disabled={!url.trim()}
            onClick={() => void onLink({ url, title: title.trim() || undefined }).then(finish)}
          >
            {labels.saveLink}
          </Button>
        </>
      ) : null}
      {mode === 'files' ? (
        <label className='mt-20px flex min-h-120px cursor-pointer items-center justify-center border border-dashed border-border-3 bg-fill-1 px-20px text-13px text-t-secondary hover:border-primary-6'>
          {labels.addFiles}
          <input
            className='sr-only'
            type='file'
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) void onFiles(files).then(finish);
            }}
          />
        </label>
      ) : null}
    </Drawer>
  );
};

export default InboxCaptureDrawer;
