// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { createElectronMemoryClient } from '@renderer/pages/settings/memory/memoryClient';

describe('memory client', () => {
  it('maps renderer calls to the typed Electron providers', async () => {
    const listCandidates = vi
      .spyOn(ipcBridge.memory.listCandidates, 'invoke')
      .mockResolvedValue({ candidates: [], total: 0 });
    const getMemory = vi.spyOn(ipcBridge.memory.getMemory, 'invoke').mockResolvedValue(null);
    const forgetMemory = vi.spyOn(ipcBridge.memory.forgetMemory, 'invoke').mockResolvedValue();
    const getStatus = vi.spyOn(ipcBridge.memory.getStatus, 'invoke').mockResolvedValue({
      pendingCount: 0,
      activeCount: 0,
      expiredCount: 0,
      sensitiveCount: 0,
    });
    const client = createElectronMemoryClient();

    await client.listCandidates({ limit: 20 });
    await client.getMemory('memory-1');
    await client.forgetMemory('memory-1');
    await client.getStatus();

    expect(listCandidates).toHaveBeenCalledWith({ limit: 20 });
    expect(getMemory).toHaveBeenCalledWith({ id: 'memory-1' });
    expect(forgetMemory).toHaveBeenCalledWith({ id: 'memory-1' });
    expect(getStatus).toHaveBeenCalledOnce();
  });
});
