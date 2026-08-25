import { existsSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_MEMORY_MCP_NAME } from '@/common/config/constants';
import { SEARCHT_BRAND } from '@/common/config/brand';
import { MEMORY_SENSITIVITIES, MEMORY_TYPES } from '@/common/types/searcht/memory';
import { MemoryAgentPort } from '@process/services/personal-core/memory/MemoryAgentPort';
import { MemoryService } from '@process/services/personal-core/memory/MemoryService';
import { NodeSqliteDriver } from './memoryMcpDriver';
import { createMemoryMcpRuntime } from './memoryMcpRuntime';

async function main(): Promise<void> {
  const dataDirectory = process.env.SEARCHT_PERSONAL_DATA_DIR;
  if (!dataDirectory) throw new Error('MEMORY_DATA_DIRECTORY_REQUIRED');
  const databasePath = path.join(dataDirectory, 'personal-core', SEARCHT_BRAND.personalDatabaseName);
  if (!existsSync(databasePath)) throw new Error('MEMORY_DATABASE_UNAVAILABLE');

  const driver = new NodeSqliteDriver(databasePath);
  const version = driver.pragma('user_version', { simple: true });
  if (typeof version !== 'number' || version < 6) {
    driver.close();
    throw new Error('MEMORY_DATABASE_UPGRADE_REQUIRED');
  }
  const runtime = createMemoryMcpRuntime(new MemoryAgentPort(new MemoryService(driver)), process.cwd());
  const server = new McpServer({ name: BUILTIN_MEMORY_MCP_NAME, version: '1.0.0' });

  server.tool(
    'searcht_memory_propose',
    'Submit a possible long-term memory for user review. This never confirms or activates the memory.',
    {
      content: z.string().min(1).max(4_000),
      memory_type: z.enum(MEMORY_TYPES),
      scope: z.enum(['workspace', 'global']).default('workspace'),
      sensitivity: z.enum(MEMORY_SENSITIVITIES).default('normal'),
      confidence: z.number().min(0).max(1).default(0.75),
      reason: z.string().min(1).max(1_000),
      source_id: z.string().min(1),
      source_label: z.string().min(1).optional(),
      suggested_expires_at: z.number().int().nonnegative().nullable().optional(),
    },
    async (input) => {
      try {
        const candidate = runtime.propose({
          content: input.content,
          memoryType: input.memory_type,
          scope: input.scope,
          sensitivity: input.sensitivity,
          confidence: input.confidence,
          reason: input.reason,
          sourceId: input.source_id,
          sourceLabel: input.source_label,
          suggestedExpiresAt: input.suggested_expires_at ?? null,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ candidateId: candidate.id, status: 'pending-user-review' }),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    'searcht_memory_retrieve',
    'Retrieve active, non-sensitive memory only from the current workspace or global scope.',
    {
      query: z.string().max(1_000).default(''),
      scopes: z
        .array(z.enum(['workspace', 'global']))
        .min(1)
        .default(['workspace', 'global']),
      limit: z.number().int().min(1).max(50).default(10),
    },
    async (input) => {
      try {
        const result = runtime.retrieve({ query: input.query, scopes: input.scopes, limit: input.limit });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                memories: result.hits.map((hit) => ({
                  id: hit.memory.id,
                  content: hit.memory.content,
                  memoryType: hit.memory.memoryType,
                  scope: hit.memory.scope,
                  reason: hit.memory.reason,
                  confidence: hit.memory.confidence,
                  sourceReferences: hit.memory.sourceReferences,
                })),
              }),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  const close = (): void => driver.close();
  process.once('exit', close);
  process.once('SIGINT', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));
  await server.connect(new StdioServerTransport());
}

function toolError(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'MEMORY_TOOL_FAILED' }],
    isError: true,
  };
}

void main().catch((error) => {
  console.error('[SearchtMemoryMCP] Fatal error:', error);
  process.exit(1);
});
