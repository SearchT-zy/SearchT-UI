import { describe, expect, it } from 'vitest';
import type { IMessageText, TMessage } from '@/common/chat/chatLib';
import { resolveCompletedTurnResult } from '@renderer/pages/team/group/groupTurnResultResolver';

const assistantText = (
  id: string,
  content: string,
  createdAt: number,
  overrides: Partial<IMessageText> = {}
): IMessageText => ({
  id,
  conversation_id: 'conversation-hermes',
  type: 'text',
  content: { content },
  position: 'left',
  status: 'finish',
  hidden: false,
  created_at: createdAt,
  ...overrides,
});

describe('resolveCompletedTurnResult', () => {
  it('prefers text anchored to the completed backend turn', () => {
    const messages: TMessage[] = [
      assistantText('old', 'Older answer', 1_000, { backend_turn_id: 'turn-old' }),
      assistantText('current', 'Current answer', 2_000, { backend_turn_id: 'turn-current' }),
    ];

    expect(resolveCompletedTurnResult(messages, { turnId: 'turn-current', startedAt: 1_500 })).toEqual({
      content: 'Current answer',
      createdAt: 2_000,
    });
  });

  it('recovers unanchored Hermes ACP text created after the child turn started', () => {
    const messages: TMessage[] = [
      assistantText('old', 'Older answer', 1_000),
      assistantText('current', '<think>hidden</think>Hermes result', 2_000),
    ];

    expect(resolveCompletedTurnResult(messages, { turnId: 'turn-hermes', startedAt: 1_500 })).toEqual({
      content: 'Hermes result',
      createdAt: 2_000,
    });
  });

  it('uses the child-turn time window when backend and Team turn ids use different namespaces', () => {
    const messages: TMessage[] = [
      assistantText('old', 'Older answer', 1_000, { backend_turn_id: 'backend-turn-old' }),
      assistantText('current', 'Current answer', 2_000, { backend_turn_id: 'backend-turn-current' }),
    ];

    expect(resolveCompletedTurnResult(messages, { turnId: 'team-turn-current', startedAt: 1_500 })).toEqual({
      content: 'Current answer',
      createdAt: 2_000,
    });
  });

  it('does not reuse stale assistant text when the completed turn has no output', () => {
    const messages: TMessage[] = [assistantText('old', 'Older answer', 1_000)];

    expect(resolveCompletedTurnResult(messages, { turnId: 'turn-hermes', startedAt: 1_500 })).toBeNull();
  });

  it('ignores hidden and empty output from the completed turn', () => {
    const messages: TMessage[] = [
      assistantText('hidden', 'Internal result', 2_000, { hidden: true }),
      assistantText('empty', '   ', 2_100),
    ];

    expect(resolveCompletedTurnResult(messages, { turnId: 'turn-hermes', startedAt: 1_500 })).toBeNull();
  });
});
