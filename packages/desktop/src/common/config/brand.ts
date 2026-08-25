import path from 'path';
import { SEARCHT_DISPLAY_NAME } from './brandIdentity';

/** Product identifiers owned by the SearchT-UI hard fork. */
export const SEARCHT_BRAND = {
  appId: 'cn.searcht.desktop',
  appName: 'SearchT-UI',
  displayName: SEARCHT_DISPLAY_NAME,
  executableName: 'SearchT-UI',
  protocol: 'searcht',
  dataDirectoryName: 'searcht',
  cliDataDirectoryName: '.searcht',
  cliConfigDirectoryName: '.searcht-config',
  personalDatabaseName: 'searcht-personal.db',
} as const;

export function resolveSearchtStoragePaths(userDataPath: string): { dataPath: string; configPath: string } {
  return {
    dataPath: path.join(userDataPath, SEARCHT_BRAND.dataDirectoryName),
    configPath: path.join(userDataPath, 'config'),
  };
}
