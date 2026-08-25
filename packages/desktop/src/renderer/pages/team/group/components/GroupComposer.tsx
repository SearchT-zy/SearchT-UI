import { localFileRef, uploadFileRef, type ChatFileRef } from '@/common/types/chatFile';
import type { CollaborationTargetMode } from '@/common/types/searcht/collaboration';
import FileAttachButton from '@renderer/components/media/FileAttachButton';
import { useOpenFileSelector } from '@renderer/hooks/file/useOpenFileSelector';
import { Button, Input, Radio, Tag, Trigger } from '@arco-design/web-react';
import { AtSign, Send } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type GroupComposerMember = {
  slotId: string;
  name: string;
  ready: boolean;
};

export type GroupComposerSubmit = {
  content: string;
  targetMode: CollaborationTargetMode;
  selectedSlotIds: string[];
  fileRefs: ChatFileRef[];
};

type Props = {
  members: GroupComposerMember[];
  sending: boolean;
  onSubmit: (input: GroupComposerSubmit) => Promise<void>;
};

const GroupComposer: React.FC<Props> = ({ members, sending, onSubmit }) => {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'coordinator' | 'members'>('coordinator');
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [allSelected, setAllSelected] = useState(false);
  const [fileRefs, setFileRefs] = useState<ChatFileRef[]>([]);
  const mentionOpen = /@[^@\s]*$/.test(content);
  const selectedMembers = useMemo(
    () => members.filter((member) => selectedSlotIds.includes(member.slotId)),
    [members, selectedSlotIds]
  );
  const { openFileSelector } = useOpenFileSelector({
    onFilesSelected: (paths) => setFileRefs((current) => dedupeRefs([...current, ...paths.map(localFileRef)])),
  });

  const selectMember = (slotId: string): void => {
    setMode('members');
    setAllSelected(false);
    setSelectedSlotIds((current) => (current.includes(slotId) ? current : [...current, slotId]));
    setContent(removeMentionTrigger(content));
  };
  const selectAll = (): void => {
    setMode('members');
    setAllSelected(true);
    setSelectedSlotIds(members.map((member) => member.slotId));
    setContent(removeMentionTrigger(content));
  };
  const submit = async (): Promise<void> => {
    const normalized = content.trim();
    if (!normalized || sending || (mode === 'members' && selectedSlotIds.length === 0)) return;
    await onSubmit({
      content: normalized,
      targetMode: mode === 'coordinator' ? 'coordinator' : allSelected ? 'all' : 'members',
      selectedSlotIds,
      fileRefs,
    });
    setContent('');
    setSelectedSlotIds([]);
    setAllSelected(false);
    setFileRefs([]);
  };

  const mentionMenu = (
    <div className='max-h-260px w-260px overflow-y-auto rounded-6px border border-solid border-b-base bg-bg-2 p-6px shadow-lg'>
      <Button
        type='text'
        long
        className='!justify-start'
        data-testid='group-mention-all'
        icon={<AtSign size='14' />}
        onClick={selectAll}
      >
        {t('team.group.mention.all', { count: members.length, defaultValue: 'All members ({{count}})' })}
      </Button>
      {members.map((member) => (
        <Button
          key={member.slotId}
          type='text'
          long
          className='!justify-start'
          data-testid={`group-mention-${member.slotId}`}
          disabled={!member.ready}
          onClick={() => selectMember(member.slotId)}
        >
          <span className='truncate'>{member.name}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <div className='shrink-0 border-t border-solid border-b-base bg-bg-1 px-16px pb-14px pt-10px'>
      <div className='mb-8px flex min-h-24px flex-wrap items-center gap-6px'>
        {allSelected ? (
          <Tag closable onClose={() => (setAllSelected(false), setSelectedSlotIds([]))}>
            <span data-testid='group-target-count'>{members.length}</span>{' '}
            {t('team.group.mention.members', { defaultValue: 'members' })}
          </Tag>
        ) : (
          selectedMembers.map((member) => (
            <Tag
              key={member.slotId}
              closable
              data-testid={`group-target-${member.slotId}`}
              onClose={() => setSelectedSlotIds((current) => current.filter((slotId) => slotId !== member.slotId))}
            >
              @{member.name}
            </Tag>
          ))
        )}
        {fileRefs.map((ref) => (
          <Tag key={`${ref.kind}:${ref.kind === 'project' ? ref.relative_path : ref.path}`}>
            {ref.kind === 'project' ? ref.relative_path : ref.path.split(/[\\/]/).pop()}
          </Tag>
        ))}
      </div>
      <Trigger popup={() => mentionMenu} popupVisible={mentionOpen} position='top' trigger='click'>
        <Input.TextArea
          data-testid='group-composer-input'
          value={content}
          onChange={setContent}
          autoSize={{ minRows: 3, maxRows: 7 }}
          placeholder={t('team.group.composer.placeholder', {
            defaultValue: 'Describe the goal or type @ to choose a member',
          })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !mentionOpen) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </Trigger>
      <div className='mt-8px flex h-36px min-w-0 items-center justify-between gap-8px'>
        <div className='flex min-w-0 items-center gap-8px'>
          <FileAttachButton
            openFileSelector={openFileSelector}
            onLocalFilesAdded={(files) =>
              setFileRefs((current) => dedupeRefs([...current, ...files.map((file) => uploadFileRef(file.path))]))
            }
          />
          <Radio.Group type='button' value={mode} onChange={setMode}>
            <Radio value='coordinator' data-testid='group-mode-coordinator'>
              {t('team.group.mode.coordinator', { defaultValue: 'Coordinate' })}
            </Radio>
            <Radio value='members' data-testid='group-mode-members'>
              {t('team.group.mode.direct', { defaultValue: 'Assign directly' })}
            </Radio>
          </Radio.Group>
        </div>
        <Button
          type='primary'
          icon={<Send size='16' />}
          loading={sending}
          disabled={!content.trim() || (mode === 'members' && selectedSlotIds.length === 0)}
          data-testid='group-send'
          aria-label={t('common.send')}
          onClick={() => void submit()}
        />
      </div>
    </div>
  );
};

function removeMentionTrigger(value: string): string {
  return value.replace(/@[^@\s]*$/, '').trimEnd();
}

function dedupeRefs(refs: ChatFileRef[]): ChatFileRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = ref.kind === 'project' ? `${ref.kind}:${ref.pe_id}:${ref.relative_path}` : `${ref.kind}:${ref.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default GroupComposer;
