export const PERSONAL_WEB_DATABASE_NAME = 'searcht-personal-core';
export const PERSONAL_WEB_DATABASE_VERSION = 7;

export const PERSONAL_WEB_STORE_NAMES = {
  assets: 'inboxAssets',
  origins: 'inboxAssetOrigins',
  items: 'inboxItems',
  links: 'sourceLinks',
  operations: 'conversionOperations',
  notes: 'notes',
  revisions: 'noteRevisions',
  knowledge: 'knowledgeSources',
  memoryCandidates: 'memoryCandidates',
  memoryItems: 'memoryItems',
  skillCandidates: 'skillCandidates',
  managedSkills: 'managedSkills',
  skillVersions: 'skillVersions',
  skillAudit: 'skillAudit',
  workflowInstances: 'workflowInstances',
  workflowVersions: 'workflowVersions',
  workflowRuns: 'workflowRuns',
  workflowApprovals: 'workflowApprovals',
  workflowGrants: 'workflowGrants',
  workflowAudit: 'workflowAudit',
  collaborationMessages: 'collaborationMessages',
  collaborationDeliveries: 'collaborationDeliveries',
  collaborationMembers: 'collaborationMembers',
  collaborationInviteCodes: 'collaborationInviteCodes',
} as const;

export function openPersonalWebDatabase(factory: IDBFactory, name = PERSONAL_WEB_DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(name, PERSONAL_WEB_DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => upgradePersonalWebSchema(request.result, request.transaction!), {
      once: true,
    });
    request.addEventListener(
      'success',
      () => {
        const database = request.result;
        database.addEventListener('versionchange', () => database.close());
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        resolve(database);
      },
      { once: true }
    );
    request.addEventListener(
      'error',
      () => {
        if (settled) return;
        settled = true;
        reject(request.error ?? new Error('PERSONAL_DATABASE_OPEN_FAILED'));
      },
      { once: true }
    );
    request.addEventListener(
      'blocked',
      () => {
        if (settled) return;
        settled = true;
        reject(new Error('PERSONAL_DATABASE_OPEN_BLOCKED'));
      },
      { once: true }
    );
  });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('PERSONAL_DATABASE_REQUEST_FAILED')), {
      once: true,
    });
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('PERSONAL_DATABASE_TRANSACTION_ABORTED')),
      { once: true }
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('PERSONAL_DATABASE_TRANSACTION_FAILED')),
      { once: true }
    );
  });
}

function upgradePersonalWebSchema(database: IDBDatabase, transaction: IDBTransaction): void {
  const assets = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.assets);
  ensureIndex(assets, 'sha256', 'sha256', { unique: true });
  const origins = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.origins);
  ensureIndex(origins, 'assetId', 'assetId');
  ensureIndex(origins, 'originalName', 'originalName');
  const items = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.items);
  ensureIndex(items, 'state', 'state');
  ensureIndex(items, 'kind', 'kind');
  ensureIndex(items, 'capturedAt', 'capturedAt');
  ensureIndex(items, 'originId', 'originId');
  const links = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.links);
  ensureIndex(links, 'sourceId', 'sourceId');
  ensureIndex(links, 'target', ['targetType', 'targetId'], { unique: true });
  const operations = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.operations);
  ensureIndex(operations, 'status', 'status');
  ensureIndex(operations, 'updatedAt', 'updatedAt');
  const notes = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.notes);
  ensureIndex(notes, 'updatedAt', 'updatedAt');
  ensureIndex(notes, 'archivedAt', 'archivedAt');
  ensureIndex(notes, 'deletedAt', 'deletedAt');
  const revisions = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.revisions);
  ensureIndex(revisions, 'noteId', 'noteId');
  ensureIndex(revisions, 'noteRevision', ['noteId', 'revisionNumber'], { unique: true });
  const knowledge = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.knowledge);
  ensureIndex(knowledge, 'source', ['sourceType', 'sourceId'], { unique: true });
  ensureIndex(knowledge, 'updatedAt', 'updatedAt');
  const memoryCandidates = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.memoryCandidates);
  ensureIndex(memoryCandidates, 'operationId', 'operationId', { unique: true });
  ensureIndex(memoryCandidates, 'updatedAt', 'updatedAt');
  const memoryItems = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.memoryItems);
  ensureIndex(memoryItems, 'scope', ['scope.kind', 'scope.id']);
  ensureIndex(memoryItems, 'updatedAt', 'updatedAt');
  ensureIndex(memoryItems, 'expiresAt', 'expiresAt');
  ensureIndex(memoryItems, 'memoryType', 'memoryType');
  const skillCandidates = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.skillCandidates);
  ensureIndex(skillCandidates, 'operationId', 'operationId', { unique: true });
  ensureIndex(skillCandidates, 'updatedAt', 'updatedAt');
  const managedSkills = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.managedSkills);
  ensureIndex(managedSkills, 'slug', 'slug', { unique: true });
  ensureIndex(managedSkills, 'state', 'state');
  ensureIndex(managedSkills, 'updatedAt', 'updatedAt');
  const skillVersions = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.skillVersions);
  ensureIndex(skillVersions, 'skillId', 'skillId');
  ensureIndex(skillVersions, 'skillVersion', ['skillId', 'versionNumber'], { unique: true });
  ensureIndex(skillVersions, 'publishedAt', 'publishedAt');
  const skillAudit = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.skillAudit);
  ensureIndex(skillAudit, 'createdAt', 'createdAt');
  const workflowInstances = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.workflowInstances);
  ensureIndex(workflowInstances, 'operationId', 'operationId', { unique: true });
  ensureIndex(workflowInstances, 'runtimeJobId', 'runtimeJobId', { unique: true });
  ensureIndex(workflowInstances, 'state', 'state');
  ensureIndex(workflowInstances, 'updatedAt', 'updatedAt');
  const workflowVersions = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.workflowVersions);
  ensureIndex(workflowVersions, 'workflowId', 'workflowId');
  ensureIndex(workflowVersions, 'workflowVersion', ['workflowId', 'versionNumber'], { unique: true });
  const workflowRuns = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.workflowRuns);
  ensureIndex(workflowRuns, 'workflowId', 'workflowId');
  ensureIndex(workflowRuns, 'workflowRun', ['workflowId', 'runtimeRunKey'], { unique: true });
  ensureIndex(workflowRuns, 'createdAt', 'createdAt');
  const workflowApprovals = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.workflowApprovals);
  ensureIndex(workflowApprovals, 'runId', 'runId');
  ensureIndex(workflowApprovals, 'runAction', ['runId', 'resource', 'action'], { unique: true });
  const workflowGrants = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.workflowGrants);
  ensureIndex(workflowGrants, 'workflowId', 'workflowId');
  ensureIndex(workflowGrants, 'expiresAt', 'expiresAt');
  const workflowAudit = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.workflowAudit);
  ensureIndex(workflowAudit, 'createdAt', 'createdAt');
  const collaborationMessages = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.collaborationMessages);
  ensureIndex(collaborationMessages, 'teamCreated', ['teamId', 'createdAt']);
  ensureIndex(collaborationMessages, 'sourceEventId', 'sourceEventId', { unique: true });
  const collaborationDeliveries = getOrCreateStore(
    database,
    transaction,
    PERSONAL_WEB_STORE_NAMES.collaborationDeliveries
  );
  ensureIndex(collaborationDeliveries, 'messageId', 'messageId');
  ensureIndex(collaborationDeliveries, 'messageTarget', ['messageId', 'targetSlotId'], { unique: true });
  ensureIndex(collaborationDeliveries, 'teamRunId', 'teamRunId');
  const collaborationMembers = getOrCreateStore(database, transaction, PERSONAL_WEB_STORE_NAMES.collaborationMembers);
  ensureIndex(collaborationMembers, 'teamKey', ['teamId', 'memberKey'], { unique: true });
  ensureIndex(collaborationMembers, 'teamJoined', ['teamId', 'joinedAt']);
  const collaborationInviteCodes = getOrCreateStore(
    database,
    transaction,
    PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes
  );
  ensureIndex(collaborationInviteCodes, 'code', 'code', { unique: true });
  ensureIndex(collaborationInviteCodes, 'teamCreated', ['teamId', 'createdAt']);
}

function getOrCreateStore(database: IDBDatabase, transaction: IDBTransaction, name: string): IDBObjectStore {
  return database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, { keyPath: 'id' });
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters
): void {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}
