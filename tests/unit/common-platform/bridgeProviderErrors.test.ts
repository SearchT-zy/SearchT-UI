import { describe, expect, it } from 'vitest';
import { adapter, buildProvider } from '@/common/platform/bridge';

describe('bridge provider errors', () => {
  it('rejects the caller when a provider throws', async () => {
    let receiver: { emit: (name: string, data: unknown) => unknown } | undefined;
    adapter({
      emit(name, data) {
        queueMicrotask(() => receiver?.emit(name, data));
      },
      on(emitter) {
        receiver = emitter;
      },
    });
    const provider = buildProvider<void, void>('test.provider.error');
    const dispose = provider.provider(() => {
      throw new Error('disk full');
    });

    await expect(provider.invoke()).rejects.toThrow('disk full');
    dispose();
  });
});
