/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
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

  it('sends without throwing and restores backend skill ids on inject_skills', async () => {
    const bridge = await import('@/common/adapter/ipcBridge');

    const result = await bridge.conversation.sendMessage.invoke({
      conversation_id: 'conv-1',
      input: 'hello',
      inject_skills: ['searcht-config', 'searcht-app-guide'],
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
