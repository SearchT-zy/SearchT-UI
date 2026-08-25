/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initApplicationBridge } from './applicationBridge';
import { initDialogBridge } from './dialogBridge';
import { initUpdateBridge } from './updateBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initWebuiBridge } from './webuiBridge';
import { initThemeBridge } from './themeBridge';
import { initCollaborationBridge, initPersonalWorkspaceBridge } from './personalWorkspaceBridge';
import { initTaskBridge } from './taskBridge';
import { initCalendarBridge } from './calendarBridge';
import { initInboxBridge } from './inboxBridge';
import { initKnowledgeBridge } from './knowledgeBridge';
import { initNotesBridge } from './notesBridge';
import { initMemoryBridge } from './memoryBridge';
import { initSkillLifecycleBridge } from './skillLifecycleBridge';
import { initWorkflowBridge } from './workflowBridge';
import { initConnectorBridge } from './connectorBridge';
import { initCloudSyncBridge } from './cloudSyncBridge';

export type BridgeDependencies = Record<string, never>;

export function initAllBridges(_deps: BridgeDependencies = {}): void {
  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initWebuiBridge();
  initThemeBridge();
  initPersonalWorkspaceBridge();
  initCollaborationBridge();
  initTaskBridge();
  initCalendarBridge();
  initInboxBridge();
  initNotesBridge();
  initKnowledgeBridge();
  initMemoryBridge();
  initSkillLifecycleBridge();
  initWorkflowBridge();
  initConnectorBridge();
  initCloudSyncBridge();
}

export {
  initApplicationBridge,
  initDialogBridge,
  initNotificationBridge,
  initSystemSettingsBridge,
  initThemeBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
  initPersonalWorkspaceBridge,
  initCloudSyncBridge,
  initCollaborationBridge,
  initTaskBridge,
  initCalendarBridge,
  initInboxBridge,
  initNotesBridge,
  initKnowledgeBridge,
  initMemoryBridge,
  initSkillLifecycleBridge,
  initWorkflowBridge,
  initConnectorBridge,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
