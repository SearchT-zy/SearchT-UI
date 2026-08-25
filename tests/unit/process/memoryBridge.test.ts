import { describe, expect, it, vi } from 'vitest';
import { initMemoryBridge } from '@process/bridge/memoryBridge';

function makeService() {
  return {
    listCandidates: vi.fn(() => ({ candidates: [], total: 0 })),
    submitCandidate: vi.fn(() => ({ id: 'candidate-1' })),
    confirmCandidate: vi.fn(() => ({ id: 'memory-1' })),
    rejectCandidate: vi.fn(),
    listMemories: vi.fn(() => ({ memories: [], total: 0 })),
    getMemory: vi.fn(() => null),
    createMemory: vi.fn(() => ({ id: 'memory-1' })),
    updateMemory: vi.fn(() => ({ id: 'memory-1' })),
    forgetMemory: vi.fn(),
    retrieve: vi.fn(() => ({ hits: [] })),
    getStatus: vi.fn(() => ({ pendingCount: 0, activeCount: 0, expiredCount: 0, sensitiveCount: 0 })),
    exportMemories: vi.fn(() => ({ exportedAt: 100, memories: [] })),
  };
}

describe('memory bridge', () => {
  it('forwards candidate review and memory management commands', async () => {
    const service = makeService();
    const handlers = initMemoryBridge({ service: service as never });
    const candidateInput = {
      operationId: 'operation-1',
      content: 'Prefers concise summaries',
      memoryType: 'preference' as const,
      proposedScope: { kind: 'global' as const, id: null },
      sensitivity: 'normal' as const,
      confidence: 0.9,
      reason: 'Repeated request',
      sourceReferences: [{ kind: 'conversation-message' as const, id: 'message-1' }],
      suggestedExpiresAt: null,
    };
    const confirmInput = {
      candidateId: 'candidate-1',
      content: candidateInput.content,
      memoryType: candidateInput.memoryType,
      scope: candidateInput.proposedScope,
      sensitivity: candidateInput.sensitivity,
      confidence: candidateInput.confidence,
      reason: candidateInput.reason,
      expiresAt: null,
      reviewAt: null,
    };
    const createInput = {
      content: candidateInput.content,
      memoryType: candidateInput.memoryType,
      scope: candidateInput.proposedScope,
      sensitivity: candidateInput.sensitivity,
      confidence: candidateInput.confidence,
      reason: candidateInput.reason,
      expiresAt: null,
      reviewAt: null,
    };
    const updateInput = {
      id: 'memory-1',
      ...createInput,
      sourceReferences: [{ kind: 'manual' as const, id: 'memory-1' }],
    };
    const retrieveInput = {
      query: 'summary',
      scopes: [{ kind: 'global' as const, id: null }],
      includeSensitive: false,
      limit: 5,
    };

    await handlers.listCandidates({ limit: 20 });
    await handlers.submitCandidate(candidateInput);
    await handlers.confirmCandidate(confirmInput);
    await handlers.rejectCandidate('candidate-1');
    await handlers.listMemories({ view: 'active', search: 'summary' });
    await handlers.getMemory('memory-1');
    await handlers.createMemory(createInput);
    await handlers.updateMemory(updateInput);
    await handlers.forgetMemory('memory-1');
    await handlers.retrieve(retrieveInput);
    await handlers.getStatus();
    await handlers.exportMemories();

    expect(service.listCandidates).toHaveBeenCalledWith({ limit: 20 });
    expect(service.submitCandidate).toHaveBeenCalledWith(candidateInput);
    expect(service.confirmCandidate).toHaveBeenCalledWith(confirmInput);
    expect(service.rejectCandidate).toHaveBeenCalledWith('candidate-1');
    expect(service.listMemories).toHaveBeenCalledWith({ view: 'active', search: 'summary' });
    expect(service.getMemory).toHaveBeenCalledWith('memory-1');
    expect(service.createMemory).toHaveBeenCalledWith(createInput);
    expect(service.updateMemory).toHaveBeenCalledWith(updateInput);
    expect(service.forgetMemory).toHaveBeenCalledWith('memory-1');
    expect(service.retrieve).toHaveBeenCalledWith(retrieveInput);
    expect(service.getStatus).toHaveBeenCalledOnce();
    expect(service.exportMemories).toHaveBeenCalledOnce();
  });

  it('propagates stable service errors', async () => {
    const service = makeService();
    service.getMemory.mockImplementation(() => {
      throw new Error('MEMORY_ID_REQUIRED');
    });
    const handlers = initMemoryBridge({ service: service as never });

    await expect(handlers.getMemory(' ')).rejects.toThrow('MEMORY_ID_REQUIRED');
  });
});
