import { describe, expect, it, vi } from 'vitest';
import { initKnowledgeBridge } from '@process/bridge/knowledgeBridge';

function makeService() {
  return {
    search: vi.fn(() => ({ hits: [], total: 0 })),
    getStatus: vi.fn(() => ({ sourceCount: 0, noteCount: 0, inboxCount: 0, lastIndexedAt: null })),
    rebuild: vi.fn(() => ({ indexedCount: 0, failedCount: 0, completedAt: 10 })),
    removeSource: vi.fn(() => undefined),
  };
}

describe('knowledge bridge', () => {
  it('forwards search, status, rebuild, and source removal through narrow handlers', async () => {
    const service = makeService();
    const handlers = initKnowledgeBridge({ service: service as never });

    await handlers.search({ query: 'release', sourceTypes: ['note'], limit: 20 });
    await handlers.getStatus();
    await handlers.rebuild();
    await handlers.removeSource('source-1');

    expect(service.search).toHaveBeenCalledWith({ query: 'release', sourceTypes: ['note'], limit: 20 });
    expect(service.getStatus).toHaveBeenCalledWith();
    expect(service.rebuild).toHaveBeenCalledWith();
    expect(service.removeSource).toHaveBeenCalledWith('source-1');
  });

  it('propagates rebuild failures without substituting an empty result', async () => {
    const service = makeService();
    service.rebuild.mockImplementation(() => {
      throw new Error('KNOWLEDGE_REBUILD_FAILED');
    });
    const handlers = initKnowledgeBridge({ service: service as never });

    await expect(handlers.rebuild()).rejects.toThrow('KNOWLEDGE_REBUILD_FAILED');
  });
});
