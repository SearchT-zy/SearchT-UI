import { describe, expect, it } from 'vitest';
import {
  resolveCreateTaskInitialDraft,
  type CreateTaskDialogInitialDraft,
} from '@renderer/pages/cron/ScheduledTasksPage/createTaskDraft';

describe('workflow template scheduled-task draft', () => {
  it('maps a workflow Cron suggestion into the existing task editor controls', () => {
    const draft: CreateTaskDialogInitialDraft = {
      name: 'Daily planning',
      prompt: 'Compiled workflow prompt',
      schedule: { kind: 'cron', expr: '0 8 * * *', description: 'Every day at 08:00' },
      executionMode: 'new_conversation',
      queueEnabled: true,
    };

    expect(resolveCreateTaskInitialDraft(draft)).toMatchObject({
      name: 'Daily planning',
      prompt: 'Compiled workflow prompt',
      frequency: 'daily',
      time: '08:00',
      executionMode: 'new_conversation',
      queueEnabled: true,
    });
  });

  it('keeps manual workflow templates manual without inventing a schedule', () => {
    expect(
      resolveCreateTaskInitialDraft({
        name: 'Inbox triage',
        prompt: 'Prompt',
        schedule: { kind: 'cron', expr: '', description: 'Manual' },
      })
    ).toMatchObject({ frequency: 'manual', time: '09:00', queueEnabled: false });
  });
});
