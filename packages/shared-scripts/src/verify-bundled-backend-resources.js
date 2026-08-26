const fs = require('fs');
const path = require('path');

/**
 * Verify the bundled backend resources layout under
 * resources/bundled-backend/{platform}-{arch}/.
 *
 * All contract-supplied relative paths are validated (no "..", no absolute,
 * no backslashes) and every resolved path is checked to stay inside its
 * bundling root before touching the filesystem.
 */

function backendBinaryName(platform) {
  return platform === 'win32' ? 'searcht-backend.exe' : 'searcht-backend';
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function bundledPath(runtimeKey, ...parts) {
  return normalize(path.join('bundled-backend', runtimeKey, ...parts));
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

/** Resolve root + validated relative path, refusing anything escaping root. */
function safeJoin(root, relativePath) {
  const target = path.resolve(root, ...String(relativePath).split('/'));
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return target;
}

function addFailure(failures, missing, checked, failure) {
  if (failure.path) checked.push(failure.path);
  failures.push(failure);
  if (failure.path) {
    missing.push(
      failure.reason === 'missing_file' || failure.reason === 'missing_directory'
        ? failure.path
        : `${failure.path}<${failure.reason}>`
    );
  }
}

function addSchemaFailure(failures, missing, component, reason, pathLabel) {
  addFailure(failures, missing, [], { component, reason, path: pathLabel });
}

function requireBackendBinary(baseDir, runtimeKey, platform, checked, missing, failures) {
  const binary = backendBinaryName(platform);
  const relativePath = bundledPath(runtimeKey, binary);
  checked.push(relativePath);
  if (!isFile(path.join(baseDir, binary))) {
    failures.push({ component: 'backend', reason: 'missing_file', path: relativePath });
    missing.push(relativePath);
  }
}

function requireManagedResourcesDir(baseDir, runtimeKey, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, 'managed-resources');
  checked.push(relativePath);
  if (!isDirectory(path.join(baseDir, 'managed-resources'))) {
    failures.push({ component: 'managed-resources', reason: 'missing_directory', path: relativePath });
    missing.push(relativePath);
  }
}

function readJson(filePath) {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { error };
  }
}

function verifyBundleManifest(baseDir, runtimeKey, electronPlatformName, targetArch, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, 'manifest.json');
  const manifestPath = path.join(baseDir, 'manifest.json');
  checked.push(relativePath);

  if (!isFile(manifestPath)) {
    missing.push(relativePath);
    failures.push({ component: 'bundle-manifest', reason: 'missing_file', path: relativePath });
    return;
  }

  const { value: manifest, error } = readJson(manifestPath);
  if (error || !manifest) {
    missing.push(`${relativePath}<invalid-json>`);
    failures.push({ component: 'bundle-manifest', reason: 'invalid_json', path: relativePath });
    return;
  }

  if (manifest.platform !== electronPlatformName) {
    missing.push(`${relativePath}<platform:${electronPlatformName}>`);
    failures.push({ component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath });
  }

  if (manifest.arch !== targetArch) {
    missing.push(`${relativePath}<arch:${targetArch}>`);
    failures.push({ component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath });
  }
}

function validateContractRelativePath(value) {
  if (typeof value !== 'string') return false;
  if (!value || value.includes('\\') || path.isAbsolute(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function contractBundledPath(runtimeKey, ...parts) {
  return bundledPath(runtimeKey, 'managed-resources', ...parts);
}

function stringField(value) {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function validateContractPathField(value, component, pathLabel, failures) {
  if (!validateContractRelativePath(value)) {
    failures.push({ component, reason: 'invalid_contract_path', detail: pathLabel });
    return false;
  }
  return true;
}

function verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures) {
  const managedRoot = path.join(baseDir, 'managed-resources');
  const relativePath = contractBundledPath(runtimeKey, 'manifest.json');
  const manifestPath = path.join(managedRoot, 'manifest.json');
  checked.push(relativePath);

  if (!isFile(manifestPath)) {
    addFailure(failures, missing, [], {
      component: 'managed-resources',
      reason: 'missing_file',
      path: relativePath,
    });
    return;
  }

  const { value: contract, error } = readJson(manifestPath);
  if (error) {
    addFailure(failures, missing, [], {
      component: 'managed-resources',
      reason: 'invalid_json',
      path: relativePath,
    });
    return;
  }

  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }
  if (contract.schemaVersion !== 2) {
    addSchemaFailure(
      failures,
      missing,
      'managed-resources',
      typeof contract.schemaVersion === 'number' ? 'unsupported_schema_version' : 'invalid_schema',
      relativePath
    );
    return;
  }
  if (contract.runtimeKey !== runtimeKey) {
    addSchemaFailure(failures, missing, 'managed-resources', 'runtime_key_mismatch', relativePath);
    return;
  }
  if (!contract.node || typeof contract.node !== 'object' || Array.isArray(contract.node)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }
  if (!Array.isArray(contract.clis)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }

  verifyManagedNode(managedRoot, runtimeKey, contract, checked, missing, failures);
  verifyManagedClis(managedRoot, runtimeKey, contract, checked, missing, failures);
}

function verifyManagedNode(baseDir, runtimeKey, contract, checked, missing, failures) {
  const node = contract.node;
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  if (!stringField(node.version) || !stringField(node.root) || !stringField(node.executable)) {
    addSchemaFailure(failures, missing, 'managed-node', 'invalid_schema', manifestPath);
    return;
  }
  if (
    !validateContractPathField(node.root, 'managed-node', 'node.root', failures) ||
    !validateContractPathField(node.executable, 'managed-node', 'node.executable', failures)
  ) {
    return;
  }

  const nodeRoot = safeJoin(baseDir, node.root);
  const executablePath = nodeRoot && safeJoin(nodeRoot, node.executable);
  const relativePath = contractBundledPath(runtimeKey, node.root, node.executable);
  checked.push(relativePath);
  if (!executablePath || !isFile(executablePath)) {
    missing.push(relativePath);
    failures.push({
      component: 'managed-node',
      reason: executablePath ? 'missing_file' : 'invalid_contract_path',
      version: node.version,
      runtimeKey,
      path: relativePath,
    });
  }
}

function verifyManagedClis(baseDir, runtimeKey, contract, checked, missing, failures) {
  const seen = new Set();
  const validClis = [];

  for (const cli of contract.clis) {
    if (!cli || typeof cli !== 'object' || Array.isArray(cli) || !stringField(cli.name)) {
      addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', contractBundledPath(runtimeKey, 'manifest.json'));
      continue;
    }
    if (seen.has(cli.name)) {
      failures.push({ component: cli.name, reason: 'duplicate_cli_name' });
      continue;
    }
    seen.add(cli.name);
    validClis.push(cli);
  }

  for (const cli of validClis) {
    verifyManagedCli(baseDir, runtimeKey, cli, checked, missing, failures);
  }
}

function verifyManagedCli(baseDir, runtimeKey, cli, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  const requiredStringFields = ['name', 'version', 'root', 'platformDirectory', 'executable'];
  if (requiredStringFields.some((field) => !stringField(cli[field]))) {
    addSchemaFailure(failures, missing, cli.name, 'invalid_schema', manifestPath);
    return;
  }
  const requiredFiles = cli.requiredFiles === undefined ? [] : cli.requiredFiles;
  const requiredDirectories = cli.requiredDirectories === undefined ? [] : cli.requiredDirectories;
  if (!stringArray(requiredFiles) || !stringArray(requiredDirectories)) {
    addSchemaFailure(failures, missing, cli.name, 'invalid_schema', manifestPath);
    return;
  }
  if (cli.platformDirectory !== runtimeKey) {
    addSchemaFailure(failures, missing, cli.name, 'runtime_key_mismatch', manifestPath);
    return;
  }

  const pathFields = [
    ['root', cli.root],
    ['executable', cli.executable],
    ...requiredFiles.map((entry, index) => [`requiredFiles[${index}]`, entry]),
    ...requiredDirectories.map((entry, index) => [`requiredDirectories[${index}]`, entry]),
  ];
  if (pathFields.some(([field, value]) => !validateContractPathField(value, cli.name, field, failures))) {
    return;
  }

  requireContractFile(baseDir, runtimeKey, cli, cli.root, cli.executable, checked, missing, failures);
  for (const requiredFile of requiredFiles) {
    requireContractFile(baseDir, runtimeKey, cli, cli.root, requiredFile, checked, missing, failures);
  }
  for (const requiredDirectory of requiredDirectories) {
    requireContractDirectory(baseDir, runtimeKey, cli, cli.root, requiredDirectory, checked, missing, failures);
  }
}

function requireContractFile(baseDir, runtimeKey, cli, root, relativePath, checked, missing, failures) {
  const bundledRelative = contractBundledPath(runtimeKey, root, relativePath);
  checked.push(bundledRelative);
  const rootDir = safeJoin(baseDir, root);
  const target = rootDir && safeJoin(rootDir, relativePath);
  if (!target || !isFile(target)) {
    missing.push(bundledRelative);
    failures.push({
      component: cli.name,
      reason: target ? 'missing_file' : 'invalid_contract_path',
      version: cli.version,
      runtimeKey,
      path: bundledRelative,
    });
  }
}

function requireContractDirectory(baseDir, runtimeKey, cli, root, relativePath, checked, missing, failures) {
  const bundledRelative = contractBundledPath(runtimeKey, root, relativePath);
  checked.push(bundledRelative);
  const rootDir = safeJoin(baseDir, root);
  const target = rootDir && safeJoin(rootDir, relativePath);
  if (!target || !isDirectory(target)) {
    missing.push(bundledRelative);
    failures.push({
      component: cli.name,
      reason: target ? 'missing_directory' : 'invalid_contract_path',
      version: cli.version,
      runtimeKey,
      path: bundledRelative,
    });
  }
}

function verifyBundledBackendResources({ resourcesDir, electronPlatformName, targetArch }) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const baseDir = path.join(resourcesDir, 'bundled-backend', runtimeKey);
  const checked = [];
  const missing = [];
  const failures = [];

  requireBackendBinary(baseDir, runtimeKey, electronPlatformName, checked, missing, failures);
  verifyBundleManifest(baseDir, runtimeKey, electronPlatformName, targetArch, checked, missing, failures);
  requireManagedResourcesDir(baseDir, runtimeKey, checked, missing, failures);
  verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures);
  if (failures.length > 0 && missing.length === 0) {
    missing.push(`${contractBundledPath(runtimeKey, 'manifest.json')}<contract_failure>`);
  }

  return { runtimeKey, checked, missing, failures };
}

module.exports = {
  verifyBundledBackendResources,
};
