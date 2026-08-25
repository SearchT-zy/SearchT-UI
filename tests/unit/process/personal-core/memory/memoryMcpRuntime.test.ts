import { describe, expect, it, vi } from 'vitest';
import { createMemoryMcpRuntime, memoryWorkspaceScopeId } from '@process/resources/builtinMcp/memoryMcpRuntime';

function makePort() {
  return {
    submitCandidate: vi.fn((input) => ({ ...input, id: 'candidate-1', createdAt: 10, updatedAt: 10 })),
    retrieve: vi.fn(() => ({ hits: [] })),
  };
}

describe('Memory MCP runtime', () => {
  it('derives stable workspace scope and operation IDs from trusted runtime context', () => {
    const port = makePort();
    const runtime = createMemoryMcpRuntime(port, 'C:\\work\\product');
    const input = {
      content: 'Prefers concise summaries',
      memoryType: 'preference' as const,
      scope: 'workspace' as const,
      sensitivity: 'normal' as const,
      confidence: 0.9,
      reason: 'Repeated request',
      sourceId: 'message-1',
      sourceLabel: 'Planning chat',
      suggestedExpiresAt: null,
    };

    runtime.propose(input);
    runtime.propose(input);

    const expectedScope = { kind: 'workspace', id: memoryWorkspaceScopeId('C:\\work\\product') };
    expect(port.submitCandidate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operationId: expect.stringMatching(/^mcp-/),
        proposedScope: expectedScope,
        sourceReferences: [{ kind: 'conversation-message', id: 'message-1', label: 'Planning chat' }],
      }),
      { scopes: [{ kind: 'global', id: null }, expectedScope], sensitiveApproved: false }
    );
    expect(port.submitCandidate.mock.calls[0]?.[0].operationId).toBe(
      port.submitCandidate.mock.calls[1]?.[0].operationId
    );
  });

  it('maps retrieval to trusted current scopes without exposing sensitive memory', () => {
    const port = makePort();
    const runtime = createMemoryMcpRuntime(port, 'C:\\work\\product');

    runtime.retrieve({ query: 'summary', scopes: ['workspace', 'global'], limit: 5 });

    const workspaceScope = { kind: 'workspace', id: memoryWorkspaceScopeId('C:\\work\\product') };
    expect(port.retrieve).toHaveBeenCalledWith(
      {
        query: 'summary',
        scopes: [workspaceScope, { kind: 'global', id: null }],
        includeSensitive: false,
        limit: 5,
      },
      { scopes: [{ kind: 'global', id: null }, workspaceScope], sensitiveApproved: false }
    );
  });
});
