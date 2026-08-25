import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = fs.readFileSync(
  path.resolve('packages/desktop/src/renderer/pages/settings/ConnectionsSettings/webdav-dialog.css'),
  'utf8'
);

describe('WebDAV connection dialog layout', () => {
  it('makes the focus-lock container own the constrained column layout', () => {
    expect(stylesheet).toMatch(
      /\.searcht-webdav-dialog\s*>\s*div\[data-focus-lock-disabled\][^{]*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*max-height:\s*calc\(100vh\s*-\s*32px\);/s
    );
    expect(stylesheet).toMatch(
      /\.searcht-webdav-dialog\s+\.arco-modal-content\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s
    );
  });
});
