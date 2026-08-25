import type { Page } from '@playwright/test';
import { assistantRuntimeKey, type Assistant } from '@/common/types/agent/assistantTypes';
import { test, expect } from '../../fixtures';
import { createTeam, httpGet, httpPost, invokeBridge, navigateTo } from '../../helpers';

const TEAM_NAME = `E2E Local Agent Group ${Date.now()}`;
const COORDINATOR_MESSAGE = 'Summarize the local project status for this group test';
const DIRECT_MESSAGE = 'Check the release risks for this group test';

type GroupFixture = {
  teamId: string;
  memberSlotId: string;
};

async function findRunnableAssistants(page: Page): Promise<Assistant[]> {
  const assistants = await httpGet<Assistant[]>(page, '/api/assistants');
  const unique = new Map<string, Assistant>();
  for (const assistant of assistants) {
    if (
      assistant.enabled &&
      assistant.team_selectable &&
      assistant.agent_status === 'online' &&
      assistantRuntimeKey(assistant)
    ) {
      unique.set(assistant.id, assistant);
    }
  }
  return [...unique.values()];
}

async function createAgentGroup(page: Page, assistants: Assistant[]): Promise<GroupFixture> {
  const teamId = await createTeam(page, TEAM_NAME);
  try {
    const created = await httpGet<{ assistants?: Array<{ assistant_id?: string; role?: string }> }>(
      page,
      `/api/teams/${encodeURIComponent(teamId)}`
    );
    const leaderAssistantId = created.assistants?.find((assistant) => assistant.role === 'lead')?.assistant_id;
    const member = assistants.find((assistant) => assistant.id !== leaderAssistantId);
    if (!member) throw new Error('No second runnable assistant remains after leader selection');

    const added = await httpPost<{ slot_id?: string }>(page, `/api/teams/${encodeURIComponent(teamId)}/agents`, {
      assistant: {
        name: member.name,
        role: 'teammate',
        assistant_id: member.id,
        model: 'default',
      },
    });
    if (!added.slot_id) throw new Error('Team member creation returned no slot id');

    return { teamId, memberSlotId: added.slot_id };
  } catch (error) {
    await invokeBridge(page, 'team.remove', { id: teamId }).catch(() => {});
    throw error;
  }
}

test.describe('Local Agent Group Chat', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coordinates and directly assigns existing local agents with a persistent timeline', async ({ page }) => {
    const runnable = await findRunnableAssistants(page);
    test.skip(runnable.length < 2, 'Two online Team-compatible local assistants are required');
    if (runnable.length < 2) return;

    let fixture: GroupFixture | null = null;
    try {
      try {
        fixture = await createAgentGroup(page, runnable);
      } catch (error) {
        if (error instanceof Error && error.message.includes('No assistant option matched')) {
          test.skip(true, 'The Team creation UI exposes no runnable local assistant in this environment');
          return;
        }
        throw error;
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await navigateTo(page, `#/team/${fixture.teamId}`);

      const groupToggle = page.getByTestId('team-view-toggle-group');
      await expect(page.getByTestId('team-group-view')).toBeVisible({ timeout: 20_000 });
      await expect(groupToggle).toHaveAttribute('data-selected', 'true');
      await expect(page.getByTestId(`group-member-${fixture.memberSlotId}`)).toBeVisible();

      const composer = page.getByTestId('group-composer-input');
      await composer.fill(COORDINATOR_MESSAGE);
      await page.getByTestId('group-send').click();

      const timeline = page.getByTestId('group-timeline');
      const coordinatorMessage = timeline.getByText(COORDINATOR_MESSAGE, { exact: true });
      await expect(coordinatorMessage).toBeVisible({ timeout: 20_000 });
      await expect(coordinatorMessage.locator('..').locator('.arco-tag')).toHaveCount(1);

      await composer.fill(`${DIRECT_MESSAGE} @`);
      await page.getByTestId(`group-mention-${fixture.memberSlotId}`).click();
      await expect(page.getByTestId(`group-target-${fixture.memberSlotId}`)).toBeVisible();
      await page.getByTestId('group-send').click();

      const directMessage = timeline.getByText(DIRECT_MESSAGE, { exact: true });
      await expect(directMessage).toBeVisible({ timeout: 20_000 });
      await expect(directMessage.locator('..').locator('.arco-tag')).toContainText(fixture.memberSlotId);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('team-group-view')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('group-timeline').getByText(COORDINATOR_MESSAGE, { exact: true })).toBeVisible();
      await expect(page.getByTestId('group-timeline').getByText(DIRECT_MESSAGE, { exact: true })).toBeVisible();

      await page.getByTestId('team-view-toggle-board').click();
      await expect(page.getByTestId('team-view-toggle-board')).toHaveAttribute('data-selected', 'true');
      await page.getByTestId('team-view-toggle-parallel').click();
      await expect(page.getByTestId('team-view-toggle-parallel')).toHaveAttribute('data-selected', 'true');
      await groupToggle.click();

      await expect(page.getByTestId('team-group-view')).toBeVisible();
      await expect(page.getByTestId('group-timeline').getByText(COORDINATOR_MESSAGE, { exact: true })).toBeVisible();
      await expect(page.getByTestId('group-timeline').getByText(DIRECT_MESSAGE, { exact: true })).toBeVisible();
    } finally {
      if (fixture) await invokeBridge(page, 'team.remove', { id: fixture.teamId }).catch(() => {});
    }
  });
});
