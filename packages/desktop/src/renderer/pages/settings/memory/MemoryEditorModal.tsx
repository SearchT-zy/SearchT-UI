import React, { useEffect, useState } from 'react';
import { DatePicker, Input, InputNumber, Modal, Select } from '@arco-design/web-react';
import type { MemoryCreateInput, MemoryScopeKind, MemorySensitivity, MemoryType } from '@/common/types/searcht/memory';
import { MEMORY_SCOPE_KINDS, MEMORY_SENSITIVITIES, MEMORY_TYPES } from '@/common/types/searcht/memory';
import styles from './MemorySettings.module.css';

export type MemoryEditorMode = 'review' | 'create' | 'edit';
export type MemoryEditorValue = Omit<MemoryCreateInput, 'sourceReferences'>;

type MemoryEditorModalProps = {
  visible: boolean;
  mode: MemoryEditorMode;
  initialValue: MemoryEditorValue;
  title: string;
  okText: string;
  cancelText: string;
  loading: boolean;
  error: string | null;
  labels: {
    content: string;
    type: string;
    scope: string;
    scopeId: string;
    sensitivity: string;
    confidence: string;
    reason: string;
    expiresAt: string;
    reviewAt: string;
  };
  typeLabel: (type: MemoryType) => string;
  scopeLabel: (scope: MemoryScopeKind) => string;
  sensitivityLabel: (sensitivity: MemorySensitivity) => string;
  onCancel: () => void;
  onSubmit: (value: MemoryEditorValue) => void;
};

const MemoryEditorModal: React.FC<MemoryEditorModalProps> = ({
  visible,
  mode,
  initialValue,
  title,
  okText,
  cancelText,
  loading,
  error,
  labels,
  typeLabel,
  scopeLabel,
  sensitivityLabel,
  onCancel,
  onSubmit,
}) => {
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    if (visible) setDraft(initialValue);
  }, [initialValue, visible]);

  const valid = Boolean(
    draft.content.trim() && draft.reason.trim() && (draft.scope.kind === 'global' || draft.scope.id?.trim())
  );

  return (
    <Modal
      className={styles.editorModal}
      visible={visible}
      title={title}
      okText={okText}
      cancelText={cancelText}
      confirmLoading={loading}
      okButtonProps={{ disabled: !valid }}
      unmountOnExit={false}
      onCancel={onCancel}
      onOk={() => onSubmit(draft)}
    >
      <div className={styles.editorGrid} data-editor-mode={mode}>
        {error ? (
          <div role='alert' className={styles.editorError}>
            {error}
          </div>
        ) : null}
        <label className={styles.fullField}>
          <span>{labels.content}</span>
          <Input.TextArea
            aria-label={labels.content}
            value={draft.content}
            autoSize={{ minRows: 3, maxRows: 7 }}
            maxLength={4_000}
            showWordLimit
            onChange={(content) => setDraft((current) => ({ ...current, content }))}
          />
        </label>
        <label>
          <span>{labels.type}</span>
          <Select
            aria-label={labels.type}
            value={draft.memoryType}
            options={MEMORY_TYPES.map((type) => ({ value: type, label: typeLabel(type) }))}
            onChange={(memoryType: MemoryType) => setDraft((current) => ({ ...current, memoryType }))}
          />
        </label>
        <label>
          <span>{labels.sensitivity}</span>
          <Select
            aria-label={labels.sensitivity}
            value={draft.sensitivity}
            options={MEMORY_SENSITIVITIES.map((sensitivity) => ({
              value: sensitivity,
              label: sensitivityLabel(sensitivity),
            }))}
            onChange={(sensitivity: MemorySensitivity) => setDraft((current) => ({ ...current, sensitivity }))}
          />
        </label>
        <label>
          <span>{labels.scope}</span>
          <Select
            aria-label={labels.scope}
            value={draft.scope.kind}
            options={MEMORY_SCOPE_KINDS.map((scope) => ({ value: scope, label: scopeLabel(scope) }))}
            onChange={(kind: MemoryScopeKind) =>
              setDraft((current) => ({
                ...current,
                scope: { kind, id: kind === 'global' ? null : (current.scope.id ?? '') },
              }))
            }
          />
        </label>
        {draft.scope.kind !== 'global' ? (
          <label>
            <span>{labels.scopeId}</span>
            <Input
              aria-label={labels.scopeId}
              value={draft.scope.id ?? ''}
              onChange={(id) => setDraft((current) => ({ ...current, scope: { ...current.scope, id } }))}
            />
          </label>
        ) : null}
        <label>
          <span>{labels.confidence}</span>
          <InputNumber
            aria-label={labels.confidence}
            min={0}
            max={100}
            suffix='%'
            value={Math.round(draft.confidence * 100)}
            onChange={(value) => setDraft((current) => ({ ...current, confidence: Number(value ?? 0) / 100 }))}
          />
        </label>
        <label className={styles.fullField}>
          <span>{labels.reason}</span>
          <Input.TextArea
            aria-label={labels.reason}
            value={draft.reason}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={1_000}
            onChange={(reason) => setDraft((current) => ({ ...current, reason }))}
          />
        </label>
        <label>
          <span>{labels.expiresAt}</span>
          <DatePicker
            showTime
            allowClear
            value={draft.expiresAt ?? undefined}
            inputProps={{ 'aria-label': labels.expiresAt }}
            onChange={(_value, date) => setDraft((current) => ({ ...current, expiresAt: date.valueOf() }))}
            onClear={() => setDraft((current) => ({ ...current, expiresAt: null }))}
          />
        </label>
        <label>
          <span>{labels.reviewAt}</span>
          <DatePicker
            showTime
            allowClear
            value={draft.reviewAt ?? undefined}
            inputProps={{ 'aria-label': labels.reviewAt }}
            onChange={(_value, date) => setDraft((current) => ({ ...current, reviewAt: date.valueOf() }))}
            onClear={() => setDraft((current) => ({ ...current, reviewAt: null }))}
          />
        </label>
      </div>
    </Modal>
  );
};

export default MemoryEditorModal;
