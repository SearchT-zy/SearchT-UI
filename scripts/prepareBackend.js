/**
 * CLI wrapper for prepare-backend.
 *
 * Reads environment variables and invokes the shared module.
 *
 * Version resolution order:
 *  1. SEARCHT_BACKEND_RUN_ID env (download from backend Manual Build artifact)
 *  2. SEARCHT_BACKEND_VERSION env (for ad-hoc release overrides)
 *  3. "searchtBackendVersion" field in repo-root package.json (the pin)
 *  4. 'latest' (fallback; not recommended for reproducible builds)
 *
 * Environment variables:
 *  - SEARCHT_BACKEND_RUN_ID: backend Manual Build workflow run id
 *  - SEARCHT_BACKEND_VERSION: override the pinned version
 *  - SEARCHT_BACKEND_ARCH: target architecture (default: process.arch)
 *  - GH_TOKEN / GITHUB_TOKEN: GitHub API token (for rate limiting)
 */

const path = require('path');
// Module file kept under its legacy name (tooling-level rename is blocked by
// the security pre-scan); it exports the rebranded prepareBackend API.
const { prepareBackend } = require('../packages/shared-scripts/src/prepare-aioncore.js');
const { resolveBackendVersion } = require('./resolveBackendVersion.js');

const projectRoot = path.resolve(__dirname, '..');
const platform = process.platform;
// Support cross-compilation: SEARCHT_BACKEND_ARCH > npm_config_target_arch > process.arch
const arch = process.env.SEARCHT_BACKEND_ARCH || process.env.npm_config_target_arch || process.arch;
const version = resolveBackendVersion(projectRoot);

try {
  prepareBackend({ projectRoot, platform, arch, version });
} catch (error) {
  console.error('❌ prepareBackend failed:', error.message);
  process.exit(1);
}

module.exports = function () {
  try {
    return prepareBackend({ projectRoot, platform, arch, version });
  } catch (error) {
    console.error('❌ prepareBackend failed:', error.message);
    throw error;
  }
};
