import path from 'path';
import type { SearchtImportDiscovery } from '@/common/types/searcht/workspace';

export function discoverSearchtImport(
  roamingDirectory: string,
  exists: (candidate: string) => boolean
): SearchtImportDiscovery {
  const dataDirectory = path.join(roamingDirectory, 'AionUi', 'aionui');
  const databasePath = path.join(dataDirectory, 'aionui.db');
  const configDirectory = path.join(roamingDirectory, 'AionUi', 'config');
  const configAvailable = exists(path.join(configDirectory, 'aionui-config.txt'));
  if (!exists(databasePath) && !configAvailable) return { available: false };
  return {
    available: true,
    dataDirectory,
    databasePath: exists(databasePath) ? databasePath : path.join(dataDirectory, 'aionui.db'),
    configDirectory: configAvailable ? configDirectory : null,
  };
}
