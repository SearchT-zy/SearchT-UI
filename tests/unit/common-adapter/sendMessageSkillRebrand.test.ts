/**
 * @license
 * Copyright 2026 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: the sendMessage body mapper must resolve every helper it uses.
 * A previous build shipped `restoreBackendSkillNameList is not defined` —
 * esbuild does not type-check, so a missing import only blew up at runtime
 * in the user's face. This test invokes the real bridge end (fetch mocked),
 * which would throw the same ReferenceError if an import goes missing again.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

describe('conversation.sendMessage skill rebrand', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ success: true, data: { msg_id: 'm1', turn_id: 't1', runtime: {} } }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends without throwing and passes skill ids through verbatim', async () => {
    // Skill names are scrubbed at the data level now — the bridge must not
    // remap them. The test still guards against missing-import regressions
    // (the original bug shipped as `restoreBackendSkillNameList is not
    // defined` because esbuild does not type-check).
    const bridge = await import('@/common/adapter/ipcBridge');

    const result = await bridge.conversation.sendMessage.invoke({
      conversation_id: 'conv-1',
      input: 'hello',
      inject_skills: ['aionui-config', 'searcht-app-guide'],
    });

    expect(result.msg_id).toBe('m1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { inject_skills?: string[] };
    expect(body.inject_skills).toEqual(['aionui-config', 'searcht-app-guide']);
  });

  it('keeps the request valid when inject_skills is absent', async () => {
    const bridge = await import('@/common/adapter/ipcBridge');

    await bridge.conversation.sendMessage.invoke({
      conversation_id: 'conv-2',
      input: 'hello',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { inject_skills?: string[] };
    expect(body.inject_skills).toBeUndefined();
  });
});
