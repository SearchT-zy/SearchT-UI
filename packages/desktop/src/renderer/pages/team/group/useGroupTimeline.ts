import { ipcBridge } from '@/common';
import type { IConversationTurnCompletedEvent } from '@/common/adapter/ipcBridge';
import type { IConfirmation } from '@/common/chat/chatLib';
import type {
  ITeamActivityItem,
  ITeamChildTurnEvent,
  ITeamRunEvent,
  TeamRunStatus,
  TTeam,
} from '@/common/types/team/teamTypes';
import type { CollaborationDeliveryStatus, CollaborationSnapshot } from '@/common/types/searcht/collaboration';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { useTeamActivityFeed } from '../activity/useTeamActivityFeed';
import { groupClient } from './groupClient';
import { projectGroupTimeline } from './groupTimelineProjector';
import { resolveCompletedTurnResult } from './groupTurnResultResolver';

const EMPTY_SNAPSHOT: CollaborationSnapshot = { messages: [], deliveries: [] };

export function useGroupTimeline(team: TTeam, active = true) {
  const assistants = team.assistants ?? team.agents ?? [];
  const conversationMembers = useMemo(
    () => new Map(assistants.map((assistant) => [assistant.conversation_id, assistant] as const)),
    [assistants]
  );
  const senderNameFallbacks = useRef<Record<string, string>>({});
  const childTurnStarts = useRef(new Map<string, number>());
  const persistedResultSources = useRef(new Set<string>());
  for (const assistant of assistants) {
    senderNameFallbacks.current[assistant.slot_id] = assistant.assistant_name;
  }

  const snapshot = useSWR(active ? ['team-group-collaboration', team.id] : null, () => groupClient.list(team.id));
  const activity = useTeamActivityFeed(team.id, active, 'asc', 'all');

  const revalidate = useCallback(async () => {
    await Promise.all([snapshot.mutate(), Promise.resolve(activity.revalidate())]);
  }, [activity, snapshot]);

  useEffect(() => {
    if (!active) return;

    const persistResult = (
      member: (typeof assistants)[number],
      turnId: string,
      content: string,
      createdAt: number
    ): void => {
      const sourceEventId = turnResultSourceId(member.conversation_id, turnId);
      if (persistedResultSources.current.has(sourceEventId)) return;
      persistedResultSources.current.add(sourceEventId);
      void groupClient
        .appendEvent({
          teamId: team.id,
          sourceEventId,
          senderKind: 'agent',
          senderSlotId: member.slot_id,
          kind: 'result',
          content,
          conversationId: member.conversation_id,
          createdAt,
        })
        .then(() => snapshot.mutate())
        .catch((error: unknown) => {
          persistedResultSources.current.delete(sourceEventId);
          console.warn('[Renderer:groupTimeline] result_append_failed', { teamId: team.id, error });
        });
    };

    const applyRunEvent = (event: ITeamRunEvent): void => {
      if (event.team_id !== team.id) return;
      void groupClient
        .updateDeliveryByRun({
          teamId: team.id,
          teamRunId: event.team_run_id,
          status: collaborationStatus(event.status),
        })
        .then(() => snapshot.mutate())
        .catch((error: unknown) => {
          console.warn('[Renderer:groupTimeline] delivery_reconcile_failed', { teamId: team.id, error });
        });
    };

    const appendResult = (event: IConversationTurnCompletedEvent): void => {
      const member = conversationMembers.get(event.session_id);
      const content = textualContent(event.last_message.content);
      if (!member || !content || !event.turn_id) return;
      persistResult(member, event.turn_id, content, event.last_message.created_at);
    };

    const recordChildTurnStart = (event: ITeamChildTurnEvent): void => {
      const member = conversationMembers.get(event.conversation_id);
      if (event.team_id !== team.id || !member || member.slot_id !== event.slot_id) return;
      childTurnStarts.current.set(turnResultSourceId(event.conversation_id, event.turn_id), Date.now());
    };

    const recoverChildTurnResult = (event: ITeamChildTurnEvent): void => {
      if (event.team_id !== team.id) return;
      const sourceEventId = turnResultSourceId(event.conversation_id, event.turn_id);
      const startedAt = childTurnStarts.current.get(sourceEventId);
      childTurnStarts.current.delete(sourceEventId);
      const member = conversationMembers.get(event.conversation_id);
      if (event.status !== 'completed' || !member || member.slot_id !== event.slot_id) return;
      if (persistedResultSources.current.has(sourceEventId)) return;

      void ipcBridge.database.getConversationMessages
        .invoke({
          conversation_id: event.conversation_id,
          limit: 50,
          content_mode: 'full',
        })
        .then((page) => resolveCompletedTurnResult(page.items, { turnId: event.turn_id, startedAt }))
        .then((result) => {
          if (!result) return;
          persistResult(member, event.turn_id, result.content, result.createdAt ?? Date.now());
        })
        .catch((error: unknown) => {
          console.warn('[Renderer:groupTimeline] result_recovery_failed', {
            teamId: team.id,
            conversationId: event.conversation_id,
            turnId: event.turn_id,
            error,
          });
        });
    };

    const clearChildTurnStart = (event: ITeamChildTurnEvent): void => {
      if (event.team_id !== team.id) return;
      childTurnStarts.current.delete(turnResultSourceId(event.conversation_id, event.turn_id));
    };

    const appendApproval = (confirmation: IConfirmation<unknown> & { conversation_id: string }): void => {
      const member = conversationMembers.get(confirmation.conversation_id);
      if (!member) return;
      void groupClient
        .appendEvent({
          teamId: team.id,
          sourceEventId: `confirmation:${confirmation.conversation_id}:${confirmation.call_id || confirmation.id}`,
          senderKind: 'agent',
          senderSlotId: member.slot_id,
          kind: 'approval',
          content: confirmation.description || confirmation.title || confirmation.action || confirmation.call_id,
          conversationId: confirmation.conversation_id,
          createdAt: Date.now(),
        })
        .then(() => snapshot.mutate())
        .catch((error: unknown) => {
          console.warn('[Renderer:groupTimeline] approval_append_failed', { teamId: team.id, error });
        });
    };

    const refreshMembership = (event: { team_id: string; slot_id: string; name?: string }): void => {
      if (event.team_id !== team.id) return;
      if (event.name) senderNameFallbacks.current[event.slot_id] = event.name;
      void revalidate();
    };

    const unsubs = [
      ipcBridge.team.runAccepted.on(applyRunEvent),
      ipcBridge.team.runStarted.on(applyRunEvent),
      ipcBridge.team.runUpdated.on(applyRunEvent),
      ipcBridge.team.runCompleted.on(applyRunEvent),
      ipcBridge.team.runCancelled.on(applyRunEvent),
      ipcBridge.team.runFailed.on(applyRunEvent),
      ipcBridge.team.childTurnStarted.on(recordChildTurnStart),
      ipcBridge.team.childTurnCompleted.on(recoverChildTurnResult),
      ipcBridge.team.childTurnCancelled.on(clearChildTurnStart),
      ipcBridge.conversation.turnCompleted.on(appendResult),
      ipcBridge.conversation.confirmation.add.on(appendApproval),
      ipcBridge.team.agentRemoved.on(refreshMembership),
      ipcBridge.team.agentRenamed.on(refreshMembership),
      ipcBridge.realtime.reconnected.on(() => {
        void revalidate();
      }),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [active, conversationMembers, revalidate, snapshot, team.id]);

  useEffect(
    () => () => {
      childTurnStarts.current.clear();
      persistedResultSources.current.clear();
    },
    [team.id]
  );

  const activities = useMemo<ITeamActivityItem[]>(
    () => [
      ...activity.messages.map((message) => ({
        kind: 'message' as const,
        id: message.id,
        created_at: message.created_at,
        message,
      })),
      ...activity.tasks.map((task) => ({
        kind: 'task' as const,
        id: task.id,
        created_at: task.created_at,
        task,
      })),
    ],
    [activity.messages, activity.tasks]
  );
  const value = snapshot.data ?? EMPTY_SNAPSHOT;
  const timeline = useMemo(
    () =>
      projectGroupTimeline({
        messages: value.messages,
        deliveries: value.deliveries,
        activities,
        members: assistants.map((assistant) => ({
          slotId: assistant.slot_id,
          name: assistant.assistant_name,
        })),
        senderNameFallbacks: senderNameFallbacks.current,
      }),
    [activities, assistants, value.deliveries, value.messages]
  );

  return {
    timeline,
    snapshot: value,
    activities,
    activity,
    isLoading: snapshot.isLoading || activity.isLoading,
    error: snapshot.error ?? activity.error,
    revalidate,
  };
}

function collaborationStatus(status: TeamRunStatus): CollaborationDeliveryStatus {
  switch (status) {
    case 'accepted':
      return 'accepted';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'running':
    case 'cancelling':
      return 'running';
  }
}

function textualContent(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value !== 'object' || value === null || !('content' in value)) return null;
  const content = (value as { content?: unknown }).content;
  return typeof content === 'string' ? content.trim() || null : null;
}

function turnResultSourceId(conversationId: string, turnId: string): string {
  return `conversation-turn:${conversationId}:${turnId}`;
}
