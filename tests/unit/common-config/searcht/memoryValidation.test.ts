import { describe, expect, it } from 'vitest';
import {
  normalizeMemoryCandidateInput,
  normalizeMemoryContent,
  normalizeMemoryScope,
  normalizeMemorySources,
} from '@/common/searcht/memoryValidation';

describe('memory validation', () => {
  it('normalizes candidate content, confidence, scope, and duplicate sources', () => {
    expect(
      normalizeMemoryCandidateInput({
        operationId: ' operation-1 ',
        content: '  Prefers concise weekly summaries.  ',
        memoryType: 'preference',
        proposedScope: { kind: 'workspace', id: ' workspace-1 ' },
        sensitivity: 'normal',
        confidence: 1.4,
        reason: '  Repeatedly requested concise summaries. ',
        sourceReferences: [
          { kind: 'conversation-message', id: ' message-1 ', label: ' Request ' },
          { kind: 'conversation-message', id: 'message-1', label: 'Duplicate' },
        ],
        suggestedExpiresAt: null,
      })
    ).toEqual({
      operationId: 'operation-1',
      content: 'Prefers concise weekly summaries.',
      memoryType: 'preference',
      proposedScope: { kind: 'workspace', id: 'workspace-1' },
      sensitivity: 'normal',
      confidence: 1,
      reason: 'Repeatedly requested concise summaries.',
      sourceReferences: [{ kind: 'conversation-message', id: 'message-1', label: 'Request' }],
      suggestedExpiresAt: null,
    });
  });

  it('requires a scope ID outside global scope and removes it for global scope', () => {
    expect(normalizeMemoryScope({ kind: 'global', id: 'ignored' })).toEqual({ kind: 'global', id: null });
    expect(() => normalizeMemoryScope({ kind: 'project', id: '  ' })).toThrow('MEMORY_SCOPE_ID_REQUIRED');
  });

  it('rejects blank or oversized memory content', () => {
    expect(() => normalizeMemoryContent('   ')).toThrow('MEMORY_CONTENT_REQUIRED');
    expect(() => normalizeMemoryContent('x'.repeat(4_001))).toThrow('MEMORY_CONTENT_TOO_LONG');
  });

  it('rejects malformed source references and invalid confidence values', () => {
    expect(() => normalizeMemorySources([{ kind: 'note', id: '' }])).toThrow('MEMORY_SOURCE_ID_REQUIRED');
    expect(() =>
      normalizeMemoryCandidateInput({
        operationId: 'operation-1',
        content: 'Content',
        memoryType: 'preference',
        proposedScope: { kind: 'global', id: null },
        sensitivity: 'normal',
        confidence: Number.NaN,
        reason: 'Reason',
        sourceReferences: [],
        suggestedExpiresAt: null,
      })
    ).toThrow('MEMORY_CONFIDENCE_INVALID');
  });
});
