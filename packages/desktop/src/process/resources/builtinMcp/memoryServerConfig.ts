import { BUILTIN_MEMORY_MCP_NAME } from '@/common/config/constants';

export type BuiltinMemoryMcpServerConfig = {
  name: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
  transport: {
    type: 'stdio';
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  original_json: string;
};

export function buildMemoryMcpServerConfig(
  scriptPath: string,
  personalDataDirectory: string
): BuiltinMemoryMcpServerConfig {
  const serverConfig = {
    command: 'node',
    args: ['--disable-warning=ExperimentalWarning', scriptPath],
    env: { SEARCHT_PERSONAL_DATA_DIR: personalDataDirectory },
  };
  return {
    name: BUILTIN_MEMORY_MCP_NAME,
    description: 'Built-in SearchT-UI memory candidate and scoped retrieval tools.',
    enabled: true,
    builtin: true,
    transport: { type: 'stdio', ...serverConfig },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_MEMORY_MCP_NAME]: serverConfig } }, null, 2),
  };
}
