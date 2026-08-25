import { describe, expect, it, vi } from 'vitest';
import type { MemoryCandidateSubmitInput } from '@/common/types/searcht/memory';
import { MemoryAgentPort } from '@process/services/personal-core/memory/MemoryAgentPort';

const submission: MemoryCandidateSubmitInput = {
  operationId: 'operation-1',
  content: 'Prefers concise summaries',
  memoryType: 'preference',
  proposedScope: { kind: 'workspace', id: 'workspace-1' },
  sensitivity: 'normal',
  confidence: 0.9,
  reason: 'Repeated request',
  sourceReferences: [{ kind: 'conversation-message', id: 'message-1' }],
  suggestedExpiresAt: null,
};

function makeService() {
  return {
    submitCandidate: vi.fn((input) => ({ ...input, id: 'candidate-1', createdAt: 10, updatedAt: 10 })),
    retrieve: vi.fn(() => ({ hits: [] })),
  };
}

const context = {
  scopes: [
    { kind: 'global' as const, id: null },
    { kind: 'workspace' as const, id: 'workspace-1' },
  ],
  sensitiveApproved: false,
};

describe('MemoryAgentPort', () => {
  it('submits candidates only inside the trusted current scopes', () => {
    const service = makeService();
    const port = new MemoryAgentPort(service);

    port.submitCandidate(submission, context);

    expect(service.submitCandidate).toHaveBeenCalledWith(submission);
    expect(() =>
      port.submitCandidate({ ...submission, proposedScope: { kind: 'workspace', id: 'workspace-2' } }, context)
    ).toThrow('MEMORY_AGENT_SCOPE_FORBIDDEN');
  });

  it('retrieves only from explicit scopes that the trusted context allows', () => {
    const service = makeService();
    const port = new MemoryAgentPort(service);

    port.retrieve(
      {
        query: 'summary',
        scopes: [{ kind: 'workspace', id: 'workspace-1' }],
        includeSensitive: false,
        limit: 5,
      },
      context
    );

    expect(service.retrieve).toHaveBeenCalledWith({
      query: 'summary',
      scopes: [{ kind: 'workspace', id: 'workspace-1' }],
      includeSensitive: false,
      limit: 5,
    });
    expect(() =>
      port.retrieve(
        {
          query: 'summary',
          scopes: [{ kind: 'project', id: 'project-2' }],
          includeSensitive: false,
        },
        context
      )
    ).toThrow('MEMORY_AGENT_SCOPE_FORBIDDEN');
  });

  it('rejects wildcard scopes and sensitive retrieval without approval', () => {
    const service = makeService();
    const port = new MemoryAgentPort(service);

    expect(() =>
      port.retrieve(
        {
          query: '',
          scopes: [{ kind: 'workspace', id: '*' }],
          includeSensitive: false,
        },
        { ...context, scopes: [{ kind: 'workspace', id: '*' }] }
      )
    ).toThrow('MEMORY_AGENT_SCOPE_WILDCARD');
    expect(() =>
      port.retrieve(
        {
          query: 'private',
          scopes: [{ kind: 'global', id: null }],
          includeSensitive: true,
        },
        context
      )
    ).toThrow('MEMORY_AGENT_SENSITIVE_APPROVAL_REQUIRED');
  });

  it('allows approved sensitive retrieval without exposing user-only methods', () => {
    const service = makeService();
    const port = new MemoryAgentPort(service);

    port.retrieve(
      {
        query: 'private',
        scopes: [{ kind: 'global', id: null }],
        includeSensitive: true,
      },
      { ...context, sensitiveApproved: true }
    );

    expect(service.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ includeSensitive: true, scopes: [{ kind: 'global', id: null }] })
    );
    expect(port).not.toHaveProperty('confirmCandidate');
    expect(port).not.toHaveProperty('updateMemory');
    expect(port).not.toHaveProperty('forgetMemory');
  });
});
