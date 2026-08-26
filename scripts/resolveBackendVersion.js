/**
 * Resolve the backend version tag to download for packaging.
 *
 * Order:
 *   1. SEARCHT_BACKEND_VERSION env (ad-hoc override, e.g. CI dispatch input)
 *   2. "searchtBackendVersion" field in repo-root package.json (the pin)
 *   3. 'latest' (GitHub API releases/latest; non-reproducible fallback)
 *
 * Keep this file tiny and dependency-free — it's required from both
 * scripts/prepareBackend.js and scripts/pack-web-cli.js before
 * any project-level install has necessarily completed.
 */

const fs = require('fs');
const path = require('path');

function resolveBackendVersion(projectRoot) {
  const envOverride = process.env.SEARCHT_BACKEND_VERSION;
  if (envOverride && envOverride.trim()) {
    return envOverride.trim();
  }

  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg && typeof pkg.searchtBackendVersion === 'string' && pkg.searchtBackendVersion.trim()) {
      return pkg.searchtBackendVersion.trim();
    }
  } catch {
    // fall through
  }

  return 'latest';
}

module.exports = { resolveBackendVersion };
