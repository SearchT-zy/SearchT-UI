// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { SkillCandidate, SkillLifecycleClient } from '@/common/types/searcht/skillConsolidation';
import { validateSkillDraft } from '@/common/searcht/skillValidation';
import SkillCandidateList from '@renderer/pages/settings/SkillsSettings/consolidation/SkillCandidateList';
import SkillReviewPage, {
  type ReviewSkillPublisher,
} from '@renderer/pages/settings/SkillsSettings/consolidation/SkillReviewPage';

vi.mock('@/renderer/pages/conversation/Preview/components/editors/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label='SKILL.md'
      data-testid='skill-review-content'
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const content = `---
name: weekly-report
description: Create a weekly report
---

# Weekly report

Summarize completed work.`;

const validReport = validateSkillDraft({
  name: 'weekly-report',
  description: 'Create a weekly report',
  content,
});

const candidate: SkillCandidate = {
  id: 'candidate-1',
  operationId: 'operation-1',
  proposedName: 'weekly-report',
  description: 'Create a weekly report',
  content,
  requiredTools: ['search', 'files'],
  permissions: ['read workspace'],
  reason: 'Repeated work',
  sourceReferences: [{ kind: 'conversation', id: 'conversation-1', label: 'Weekly review' }],
  validation: validReport,
  status: 'pending',
  createdAt: 100,
  updatedAt: 100,
};

function makeClient(overrides: Partial<SkillLifecycleClient> = {}): SkillLifecycleClient {
  return {
    listCandidates: vi.fn(async () => ({ candidates: [candidate], total: 1 })),
    getCandidate: vi.fn(async () => candidate),
    submitCandidate: vi.fn(async () => candidate),
    updateCandidate: vi.fn(async (input) => ({
      ...candidate,
      ...input,
      validation: validateSkillDraft({
        name: input.proposedName,
        description: input.description,
        content: input.content,
      }),
      updatedAt: 200,
    })),
    rejectCandidate: vi.fn(async () => undefined),
    listManagedSkills: vi.fn(async () => ({ skills: [], total: 0 })),
    getManagedSkill: vi.fn(async () => null),
    listVersions: vi.fn(async () => ({ versions: [], total: 0 })),
    getVersion: vi.fn(async () => null),
    publishCandidate: vi.fn(async () => ({
      skill: {
        id: 'skill-1',
        slug: 'weekly-report',
        description: candidate.description,
        state: 'active',
        activeVersionId: 'version-1',
        createdAt: 200,
        updatedAt: 200,
      },
      version: {
        id: 'version-1',
        skillId: 'skill-1',
        versionNumber: 1,
        content,
        contentHash: 'hash',
        requiredTools: candidate.requiredTools,
        permissions: candidate.permissions,
        sourceReferences: candidate.sourceReferences,
        validation: validReport,
        changeSummary: 'Initial version',
        candidateId: candidate.id,
        createdAt: 200,
        publishedAt: 200,
      },
    })),
    rollback: vi.fn(),
    updateState: vi.fn(),
    getStatus: vi.fn(async () => ({ pendingCount: 1, activeCount: 0, disabledCount: 0 })),
    ...overrides,
  };
}

function renderReview(client: SkillLifecycleClient, publish: ReviewSkillPublisher, onNavigate = vi.fn()) {
  render(
    <MemoryRouter>
      <SkillReviewPage client={client} candidateId={candidate.id} publish={publish} onNavigate={onNavigate} />
    </MemoryRouter>
  );
  return onNavigate;
}

describe('skill candidate review', () => {
  it('lists candidate source, tools, and permissions and opens review', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter>
        <SkillCandidateList client={makeClient()} onOpen={onOpen} />
      </MemoryRouter>
    );

    const row = await screen.findByTestId('skill-candidate-candidate-1');
    expect(row).toHaveTextContent('Weekly review');
    expect(row).toHaveTextContent('search');
    expect(row).toHaveTextContent('read workspace');
    await userEvent.click(within(row).getByTestId('skill-candidate-review-candidate-1'));
    expect(onOpen).toHaveBeenCalledWith(candidate.id);
  });

  it('shows a load failure and retries without losing the page', async () => {
    const listCandidates = vi
      .fn<SkillLifecycleClient['listCandidates']>()
      .mockRejectedValueOnce(new Error('LOAD_FAILED'))
      .mockResolvedValueOnce({ candidates: [candidate], total: 1 });
    render(
      <MemoryRouter>
        <SkillCandidateList client={makeClient({ listCandidates })} onOpen={vi.fn()} />
      </MemoryRouter>
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('skill-candidates-retry'));
    expect(await screen.findByTestId('skill-candidate-candidate-1')).toBeInTheDocument();
  });

  it('requires confirmation before rejecting a candidate and refreshes the queue', async () => {
    const listCandidates = vi
      .fn<SkillLifecycleClient['listCandidates']>()
      .mockResolvedValueOnce({ candidates: [candidate], total: 1 })
      .mockResolvedValueOnce({ candidates: [], total: 0 });
    const rejectCandidate = vi.fn<SkillLifecycleClient['rejectCandidate']>(async () => undefined);
    render(
      <MemoryRouter>
        <SkillCandidateList client={makeClient({ listCandidates, rejectCandidate })} onOpen={vi.fn()} />
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByTestId('skill-candidate-reject-candidate-1'));
    expect(rejectCandidate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Do not use' }));

    await waitFor(() => expect(rejectCandidate).toHaveBeenCalledWith(candidate.id));
    expect(await screen.findByText('No skills are waiting for review.')).toBeInTheDocument();
  });

  it('preserves edits when saving fails and blocks invalid publication', async () => {
    const client = makeClient({ updateCandidate: vi.fn(async () => Promise.reject(new Error('SAVE_FAILED'))) });
    const publish = vi.fn<ReviewSkillPublisher>();
    renderReview(client, publish);
    const description = await screen.findByLabelText('Skill description');
    await userEvent.clear(description);
    await userEvent.type(description, 'Edited description');
    await userEvent.click(screen.getByTestId('skill-review-save'));

    expect(await screen.findByTestId('skill-review-error')).toHaveTextContent('SKILL_CANDIDATE_SAVE_FAILED');
    expect(description).toHaveValue('Edited description');

    fireEvent.change(screen.getByTestId('skill-review-content'), {
      target: { value: content.replace('Summarize completed work.', '(Full SKILL.md body here)') },
    });
    expect(screen.getByTestId('skill-review-publish')).toBeDisabled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('confirms warnings, publishes, and navigates to the normal skill detail page', async () => {
    const client = makeClient();
    const publish = vi.fn<ReviewSkillPublisher>(async (draft, commit) => {
      const commitResult = await commit({
        skill: {
          name: draft.name,
          description: candidate.description,
          location: 'C:\\skills\\weekly-report',
          is_auto_inject: false,
          is_custom: true,
          source: 'custom',
        },
        stagingPath: 'C:\\work\\searcht-skill-staging\\SKILL.md',
        installedNew: true,
      });
      return { commitResult, installedNew: true };
    });
    const onNavigate = renderReview(client, publish);
    const warnedContent = content.replace('Summarize completed work.', 'Read C:\\Users\\Alice\\Documents.');
    fireEvent.change(await screen.findByTestId('skill-review-content'), { target: { value: warnedContent } });
    await userEvent.click(screen.getByTestId('skill-review-publish'));

    expect(publish).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish anyway' }));

    await waitFor(() => expect(publish).toHaveBeenCalledOnce());
    expect(client.publishCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: candidate.id, content: warnedContent })
    );
    expect(onNavigate).toHaveBeenCalledWith('/settings/skills/detail/weekly-report');
  });

  it('keeps the review draft visible when import fails and confirms rejection', async () => {
    const client = makeClient();
    const publish = vi.fn<ReviewSkillPublisher>(async () => Promise.reject(new Error('SKILL_IMPORT_FAILED')));
    const onNavigate = renderReview(client, publish);
    await userEvent.click(await screen.findByTestId('skill-review-publish'));
    expect(await screen.findByTestId('skill-review-error')).toHaveTextContent('SKILL_CANDIDATE_PUBLISH_FAILED');
    expect(screen.getByTestId('skill-review-content')).toHaveValue(content);

    await userEvent.click(screen.getByTestId('skill-review-reject'));
    expect(client.rejectCandidate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Do not use' }));
    await waitFor(() => expect(client.rejectCandidate).toHaveBeenCalledWith(candidate.id));
    expect(onNavigate).toHaveBeenCalledWith('/settings/skills');
  });
});
