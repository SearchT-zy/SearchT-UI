import type { IMessageText, TMessage } from '@/common/chat/chatLib';
import { getLastAssistantText } from '@/renderer/utils/chat/getLastAssistantText';

export type CompletedTurnResult = {
  content: string;
  createdAt: number | undefined;
};

export type CompletedTurnResultOptions = {
  turnId: string;
  startedAt?: number;
};

export function resolveCompletedTurnResult(
  messages: TMessage[],
  options: CompletedTurnResultOptions
): CompletedTurnResult | null {
  const assistantText = messages.filter(isVisibleAssistantText);
  const anchored = assistantText.filter((message) => message.backend_turn_id === options.turnId);
  const startedAt = options.startedAt;
  const candidates =
    anchored.length > 0
      ? anchored
      : startedAt === undefined
        ? []
        : assistantText.filter((message) => (message.created_at ?? Number.NEGATIVE_INFINITY) >= startedAt);

  for (const message of candidates.toSorted(compareNewestFirst)) {
    const content = getLastAssistantText([message], false);
    if (content?.trim()) return { content, createdAt: message.created_at };
  }
  return null;
}

function isVisibleAssistantText(message: TMessage): message is IMessageText {
  return message.type === 'text' && message.position === 'left' && !message.hidden;
}

function compareNewestFirst(left: IMessageText, right: IMessageText): number {
  return (right.created_at ?? 0) - (left.created_at ?? 0) || right.id.localeCompare(left.id);
}
