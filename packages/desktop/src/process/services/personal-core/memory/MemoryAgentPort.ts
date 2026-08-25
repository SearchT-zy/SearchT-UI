import type {
  MemoryCandidate,
  MemoryCandidateSubmitInput,
  MemoryRetrieveInput,
  MemoryRetrieveResult,
  MemoryScope,
} from '@/common/types/searcht/memory';
import { memoryScopeKey } from '@/common/searcht/memorySearch';
import { normalizeMemoryScope } from '@/common/searcht/memoryValidation';
import type { MemoryService } from './MemoryService';

type MemoryAgentService = Pick<MemoryService, 'submitCandidate' | 'retrieve'>;

export type MemoryAgentContext = {
  scopes: MemoryScope[];
  sensitiveApproved: boolean;
};

export class MemoryAgentPort {
  constructor(private readonly service: MemoryAgentService) {}

  submitCandidate(input: MemoryCandidateSubmitInput, context: MemoryAgentContext): MemoryCandidate {
    const allowedScopes = this.allowedScopeKeys(context.scopes);
    const proposedScope = this.normalizeAgentScope(input.proposedScope);
    if (!allowedScopes.has(memoryScopeKey(proposedScope))) throw new Error('MEMORY_AGENT_SCOPE_FORBIDDEN');
    return this.service.submitCandidate({ ...input, proposedScope });
  }

  retrieve(input: MemoryRetrieveInput, context: MemoryAgentContext): MemoryRetrieveResult {
    if (input.includeSensitive && !context.sensitiveApproved) {
      throw new Error('MEMORY_AGENT_SENSITIVE_APPROVAL_REQUIRED');
    }
    const allowedScopes = this.allowedScopeKeys(context.scopes);
    if (!input.scopes.length) throw new Error('MEMORY_AGENT_SCOPE_REQUIRED');
    const scopes = input.scopes.map((scope) => this.normalizeAgentScope(scope));
    if (scopes.some((scope) => !allowedScopes.has(memoryScopeKey(scope)))) {
      throw new Error('MEMORY_AGENT_SCOPE_FORBIDDEN');
    }
    return this.service.retrieve({ ...input, scopes });
  }

  private allowedScopeKeys(scopes: readonly MemoryScope[]): Set<string> {
    if (!scopes.length) throw new Error('MEMORY_AGENT_SCOPE_REQUIRED');
    return new Set(scopes.map((scope) => memoryScopeKey(this.normalizeAgentScope(scope))));
  }

  private normalizeAgentScope(scope: MemoryScope): MemoryScope {
    if (scope.id && /[*?]/u.test(scope.id)) throw new Error('MEMORY_AGENT_SCOPE_WILDCARD');
    return normalizeMemoryScope(scope);
  }
}
