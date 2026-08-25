import { describe, expect, it, vi } from 'vitest';
import { installQuitCleanup } from '@process/startup/quitCleanup';

describe('installQuitCleanup', () => {
  it('closes Personal Core before stopping the backend', async () => {
    const calls: string[] = [];
    let beforeQuit: ((event: { preventDefault: () => void }) => void) | undefined;
    let resolveQuit!: () => void;
    let resolveFolderStop!: () => void;
    let resolveEmailStop!: () => void;
    let resolveWebDavStop!: () => void;
    const quitCompleted = new Promise<void>((resolve) => {
      resolveQuit = resolve;
    });
    const folderStopped = new Promise<void>((resolve) => {
      resolveFolderStop = resolve;
    });
    const emailStopped = new Promise<void>((resolve) => {
      resolveEmailStop = resolve;
    });
    const webDavStopped = new Promise<void>((resolve) => {
      resolveWebDavStop = resolve;
    });

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuit = handler;
      },
      quitApp: () => resolveQuit(),
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      stopLocalFolderConnectorScheduler: async () => {
        calls.push('folders-start');
        await folderStopped;
        calls.push('folders-end');
      },
      stopEmailConnectorScheduler: async () => {
        calls.push('email-start');
        await emailStopped;
        calls.push('email-end');
      },
      stopWebDavConnectorScheduler: async () => {
        calls.push('webdav-start');
        await webDavStopped;
        calls.push('webdav-end');
      },
      stopReminderScheduler: () => calls.push('reminders'),
      closePersonalCore: () => calls.push('personal-core'),
      stopBackend: async () => {
        calls.push('backend');
      },
      destroyPetWindow: vi.fn(),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    beforeQuit?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(calls).toEqual(['folders-start', 'email-start', 'webdav-start']));
    resolveFolderStop();
    await Promise.resolve();
    expect(calls).toContain('folders-end');
    expect(calls).not.toContain('personal-core');
    resolveEmailStop();
    await Promise.resolve();
    expect(calls).not.toContain('personal-core');
    resolveWebDavStop();
    await quitCompleted;

    expect(calls).toEqual([
      'folders-start',
      'email-start',
      'webdav-start',
      'folders-end',
      'email-end',
      'webdav-end',
      'reminders',
      'personal-core',
      'backend',
    ]);
  });
});
