import { defineConfig } from 'vitest/config';
import path from 'path';

const aliases = {
  '@/': path.resolve(__dirname, './packages/desktop/src') + '/',
  '@process/': path.resolve(__dirname, './packages/desktop/src/process') + '/',
  '@renderer/': path.resolve(__dirname, './packages/desktop/src/renderer') + '/',
  '@worker/': path.resolve(__dirname, './packages/desktop/src/process/worker') + '/',
  '@mcp/models/': path.resolve(__dirname, './packages/desktop/src/common/models') + '/',
  '@mcp/types/': path.resolve(__dirname, './packages/desktop/src/common') + '/',
  '@mcp/': path.resolve(__dirname, './packages/desktop/src/common') + '/',
  // The bun-managed better-sqlite3 entity under node_modules stays on the
  // Electron ABI (dev/packaged app). The top-level path is a SYMLINK into
  // that entity, so an `npm rebuild better-sqlite3` silently flips the shared
  // entity to the Node ABI and breaks dev/e2e launches. Tests therefore
  // resolve to an independent Node-ABI shadow copy instead. Refresh the
  // shadow with:
  //   cd node_modules/.bun/better-sqlite3@12.8.0+nodeabi/node_modules/better-sqlite3
  //   bun x prebuild-install --runtime=node --force
  'better-sqlite3': path.resolve(
    __dirname,
    './node_modules/.bun/better-sqlite3@12.8.0+nodeabi/node_modules/better-sqlite3'
  ),
};

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    globals: true,
    // CI runners (especially windows-2022) can be slow enough that dom tests
    // rendering heavy components occasionally exceed the local 10s budget.
    // The full suite runs ~585 files in parallel; local runs need the same headroom.
    testTimeout: process.env.CI ? 30000 : 30000,
    // Cap parallel workers: with ~585 test files the machine gets saturated and
    // heavy dom tests randomly starve past their timeout (moving flake). Trading
    // wall-clock for determinism.
    maxWorkers: '50%',
    // Use projects to run different environments (Vitest 4+)
    projects: [
      // Node environment tests (existing tests)
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'packages/web-host/src/**/*.test.ts',
            'tests/unit/**/*.test.ts',
            'tests/unit/**/test_*.ts',
            'tests/integration/**/*.test.ts',
            'tests/regression/**/*.test.ts',
          ],
          exclude: ['tests/unit/**/*.dom.test.ts', 'tests/unit/**/*.dom.test.tsx'],
          setupFiles: ['./tests/vitest.setup.ts'],
        },
      },
      // jsdom environment tests (React component/hook tests)
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/unit/**/*.dom.test.ts', 'tests/unit/**/*.dom.test.tsx'],
          setupFiles: ['./tests/vitest.dom.setup.ts'],
        },
      },
    ],
    benchmark: {
      include: ['tests/bench/**/*.bench.ts'],
      outputFile: './bench-results.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Cover ALL source code by default — new files are automatically included.
      // Only exclude files that genuinely cannot be unit-tested (entry points,
      // type-only files, static assets, etc.).
      include: ['packages/desktop/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
      exclude: [
        // Type declaration files (no runtime code)
        'packages/**/src/**/*.d.ts',

        // Electron entry points (require Electron runtime)
        'packages/desktop/src/index.ts',
        'packages/desktop/src/preload.ts',

        // Shims / polyfills
        'packages/desktop/src/common/utils/shims/**',

        // Pure type / constant files
        'packages/desktop/src/common/types/**',

        // Static assets and i18n JSON (no logic)
        'packages/desktop/src/renderer/**/*.json',
        'packages/desktop/src/renderer/**/*.svg',
        'packages/desktop/src/renderer/**/*.css',

        // i18n config (JSON-only)
        'packages/desktop/src/common/config/i18n-config.json',
      ],
      // Thresholds apply to the included file set.
      // Keeping them informational until coverage ramps up across all files.
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
});
