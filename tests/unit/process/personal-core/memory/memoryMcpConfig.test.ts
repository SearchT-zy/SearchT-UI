import { describe, expect, it } from 'vitest';
import { buildMemoryMcpServerConfig } from '@process/resources/builtinMcp/memoryServerConfig';

describe('built-in Memory MCP config', () => {
  it('registers an enabled built-in server with a trusted Personal Core data path', () => {
    expect(buildMemoryMcpServerConfig('C:\\app\\builtin-mcp-memory.js', 'C:\\data\\searcht')).toEqual({
      name: 'searcht-memory',
      description: 'Built-in SearchT-UI memory candidate and scoped retrieval tools.',
      enabled: true,
      builtin: true,
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['--disable-warning=ExperimentalWarning', 'C:\\app\\builtin-mcp-memory.js'],
        env: { SEARCHT_PERSONAL_DATA_DIR: 'C:\\data\\searcht' },
      },
      original_json: expect.stringContaining('SEARCHT_PERSONAL_DATA_DIR'),
    });
  });
});
