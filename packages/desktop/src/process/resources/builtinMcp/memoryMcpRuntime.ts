import { createHash } from 'node:crypto';
import type {
  MemoryCandidate,
  MemoryRetrieveResult,
  MemoryScope,
  MemorySensitivity,
  MemoryType,
} from '@/common/types/searcht/memory';
import type { MemoryAgentContext, MemoryAgentPort } from '@process/services/personal-core/memory/MemoryAgentPort';

type MemoryAgentPortContract = Pick<MemoryAgentPort, 'submitCandidate' | 'retrieve'>;
export type MemoryMcpScope = 'workspace' | 'global';

export type MemoryMcpProposeInput = {
  content: string;
  memoryType: MemoryType;
  scope: MemoryMcpScope;
  sensitivity: MemorySensitivity;
  confidence: number;
  reason: string;
  sourceId: string;
  sourceLabel?: string;
  suggestedExpiresAt: number | null;
};

export type MemoryMcpRetrieveInput = {
  query: string;
  scopes: MemoryMcpScope[];
  limit?: number;
};

export function memoryWorkspaceScopeId(workspaceDirectory: string): string {
  const normalized = workspaceDirectory.replaceAll('\\', '/').replace(/\/+$/u, '').toLocaleLowerCase();
  return `workspace-${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
}

export function createMemoryMcpRuntime(port: MemoryAgentPortContract, workspaceDirectory: string) {
  const workspaceScope: MemoryScope = { kind: 'workspace', id: memoryWorkspaceScopeId(workspaceDirectory) };
  const globalScope: MemoryScope = { kind: 'global', id: null };
  const context: MemoryAgentContext = {
    scopes: [globalScope, workspaceScope],
    sensitiveApproved: false,
  };

  return {
    propose(input: MemoryMcpProposeInput): MemoryCandidate {
      const proposedScope = input.scope === 'global' ? globalScope : workspaceScope;
      const sourceReferences = [
        {
          kind: 'conversation-message' as const,
          id: input.sourceId,
          ...(input.sourceLabel ? { label: input.sourceLabel } : {}),
        },
      ];
      const operationId = stableOperationId({ ...input, proposedScope });
      return port.submitCandidate(
        {
          operationId,
          content: input.content,
          memoryType: input.memoryType,
          proposedScope,
          sensitivity: input.sensitivity,
          confidence: input.confidence,
          reason: input.reason,
          sourceReferences,
          suggestedExpiresAt: input.suggestedExpiresAt,
        },
        context
      );
    },
    retrieve(input: MemoryMcpRetrieveInput): MemoryRetrieveResult {
      const scopes = [...new Set(input.scopes)].map((scope) => (scope === 'global' ? globalScope : workspaceScope));
      return port.retrieve(
        {
          query: input.query,
          scopes,
          includeSensitive: false,
          limit: input.limit,
        },
        context
      );
    },
  };
}

function stableOperationId(input: MemoryMcpProposeInput & { proposedScope: MemoryScope }): string {
  const value = JSON.stringify({
    content: input.content.trim(),
    memoryType: input.memoryType,
    scope: input.proposedScope,
    sensitivity: input.sensitivity,
    reason: input.reason.trim(),
    sourceId: input.sourceId.trim(),
  });
  return `mcp-${createHash('sha256').update(value).digest('hex')}`;
}
