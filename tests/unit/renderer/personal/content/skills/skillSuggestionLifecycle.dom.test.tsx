// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillCandidate, SkillLifecycleClient } from '@/common/types/searcht/skillConsolidation';
import { validateSkillDraft } from '@/common/searcht/skillValidation';
import SkillSuggestCard from '@renderer/pages/conversation/Messages/components/SkillSuggestCard';

const mocks = vi.hoisted(() => ({
  hasSkill: vi.fn(async () => false),
  saveCronSkill: vi.fn(async () => undefined),
  updateArtifact: vi.fn(async () => undefined),
  updateArtifactStatus: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      hasSkill: { invoke: mocks.hasSkill },
      saveSkill: { invoke: mocks.saveCronSkill },
    },
    conversation: {
      updateArtifact: { invoke: mocks.updateArtifact },
    },
  },
}));

vi.mock('@renderer/pages/conversation/Messages/artifacts', () => ({
  useUpdateConversationArtifactStatus: () => mocks.updateArtifactStatus,
}));

vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { success: mocks.success, error: mocks.error } };
});

const content = `---
name: weekly-report
description: Create a weekly report
---

# Weekly report

Summarize completed work.`;

const suggestion = { name: 'weekly-report', description: 'Create a weekly report', content };

const candidate: SkillCandidate = {
  id: 'candidate-1',
  operationId: 'skill-suggestion:artifact-1',
  proposedName: suggestion.name,
  description: suggestion.description,
  content,
  requiredTools: [],
  permissions: [],
  reason: 'Conversation skill suggestion',
  sourceReferences: [
    { kind: 'conversation', id: 'conversation-1', label: suggestion.name },
    { kind: 'cron', id: 'cron-1', label: suggestion.name },
  ],
  validation: validateSkillDraft({ name: suggestion.name, description: suggestion.description, content }),
  status: 'pending',
  createdAt: 100,
  updatedAt: 100,
};

function makeClient(submitCandidate = vi.fn(async () => candidate)): SkillLifecycleClient {
  return {
    listCandidates: vi.fn(async () => ({ candidates: [], total: 0 })),
    getCandidate: vi.fn(async () => null),
    submitCandidate,
    updateCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
    listManagedSkills: vi.fn(async () => ({ skills: [], total: 0 })),
    getManagedSkill: vi.fn(async () => null),
    listVersions: vi.fn(async () => ({ versions: [], total: 0 })),
    getVersion: vi.fn(async () => null),
    publishCandidate: vi.fn(),
    rollback: vi.fn(),
    updateState: vi.fn(),
    getStatus: vi.fn(async () => ({ pendingCount: 0, activeCount: 0, disabledCount: 0 })),
  };
}

function renderCard(client: SkillLifecycleClient, onNavigate = vi.fn()) {
  const view = render(
    <MemoryRouter>
      <SkillSuggestCard
        artifact_id='artifact-1'
        conversation_id='conversation-1'
        cron_job_id='cron-1'
        suggestion={suggestion}
        client={client}
        onNavigate={onNavigate}
      />
    </MemoryRouter>
  );
  return { ...view, onNavigate };
}

describe('skill suggestion lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSkill.mockResolvedValue(false);
  });

  it('creates an idempotent review candidate from the artifact and opens it', async () => {
    const submitCandidate = vi.fn<SkillLifecycleClient['submitCandidate']>(async () => candidate);
    const client = makeClient(submitCandidate);
    const first = renderCard(client);

    await userEvent.click(await screen.findByTestId('skill-suggest-add-review'));
    await waitFor(() => expect(first.onNavigate).toHaveBeenCalledWith('/settings/skills/review/candidate-1'));
    expect(submitCandidate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operationId: 'skill-suggestion:artifact-1',
        sourceReferences: expect.arrayContaining([
          expect.objectContaining({ kind: 'conversation', id: 'conversation-1' }),
          expect.objectContaining({ kind: 'cron', id: 'cron-1' }),
        ]),
      })
    );
    expect(mocks.updateArtifact).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      artifact_id: 'artifact-1',
      status: 'saved',
    });

    first.unmount();
    renderCard(client);
    await userEvent.click(await screen.findByTestId('skill-suggest-add-review'));
    expect(submitCandidate.mock.calls.map(([input]) => input.operationId)).toEqual([
      'skill-suggestion:artifact-1',
      'skill-suggestion:artifact-1',
    ]);
  });

  it('keeps the existing cron-only save action available', async () => {
    renderCard(makeClient());

    await userEvent.click(await screen.findByTestId('skill-suggest-save-cron'));

    await waitFor(() =>
      expect(mocks.saveCronSkill).toHaveBeenCalledWith({ job_id: 'cron-1', content: suggestion.content })
    );
    expect(mocks.updateArtifactStatus).toHaveBeenCalledWith('artifact-1', 'saved');
  });
});
