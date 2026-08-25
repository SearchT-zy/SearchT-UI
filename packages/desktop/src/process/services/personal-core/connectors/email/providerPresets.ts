import type { EmailProvider } from '@/common/types/searcht/connectors';

export type EmailProviderPreset = {
  host: string;
  port: number;
  secure: true;
};

const PRESETS: Record<EmailProvider, EmailProviderPreset> = {
  'qq-mail': { host: 'imap.qq.com', port: 993, secure: true },
  'netease-163': { host: 'imap.163.com', port: 993, secure: true },
};

const PROVIDER_DOMAINS: Record<EmailProvider, ReadonlySet<string>> = {
  'qq-mail': new Set(['qq.com', 'foxmail.com']),
  'netease-163': new Set(['163.com']),
};

export function resolveEmailProvider(provider: EmailProvider): EmailProviderPreset {
  const preset = PRESETS[provider];
  if (!preset) throw new Error('CONNECTOR_EMAIL_PROVIDER_UNSUPPORTED');
  return { ...preset };
}

export function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('CONNECTOR_EMAIL_ADDRESS_INVALID');
  }
  return normalized;
}

export function assertEmailAddressMatchesProvider(provider: EmailProvider, value: string): void {
  const normalized = normalizeEmailAddress(value);
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  if (!PROVIDER_DOMAINS[provider]?.has(domain)) throw new Error('CONNECTOR_EMAIL_PROVIDER_MISMATCH');
}
