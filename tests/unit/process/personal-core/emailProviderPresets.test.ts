import { describe, expect, it } from 'vitest';
import {
  assertEmailAddressMatchesProvider,
  resolveEmailProvider,
} from '@process/services/personal-core/connectors/email/providerPresets';

describe('email provider presets', () => {
  it('resolves QQ Mail to its secure IMAP endpoint', () => {
    expect(resolveEmailProvider('qq-mail')).toEqual({ host: 'imap.qq.com', port: 993, secure: true });
  });

  it('resolves 163 Mail to its secure IMAP endpoint', () => {
    expect(resolveEmailProvider('netease-163')).toEqual({ host: 'imap.163.com', port: 993, secure: true });
  });

  it('rejects an address that does not belong to the selected provider', () => {
    expect(() => assertEmailAddressMatchesProvider('qq-mail', 'person@163.com')).toThrow(
      'CONNECTOR_EMAIL_PROVIDER_MISMATCH'
    );
  });
});
