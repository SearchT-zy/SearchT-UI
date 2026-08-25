// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ManagedSkill,
  SkillLifecycleClient,
  SkillPublishResult,
  SkillVersion,
} from '@/common/types/searcht/skillConsolidation';
import { validateSkillDraft } from '@/common/searcht/skillValidation';
import SkillVersionHistory, {
  type ManagedSkillPublisher,
} from '@renderer/pages/settings/SkillsSettings/consolidation/SkillVersionHistory';

const versionOneContent = `---
name: weekly-report
description: Create a weekly report
---

# Weekly report

Create version one.`;

const versionTwoContent = versionOneContent.replace('version one', 'version two');

const managedSkill: ManagedSkill = {
  id: 'skill-1',
  slug: 'weekly-report',
  description: 'Create a weekly report',
  state: 'active',
  activeVersionId: 'version-2',
  createdAt: 100,
  updatedAt: 200,
};

const versions: SkillVersion[] = [
  makeVersion('version-2', 2, versionTwoContent),
  makeVersion('version-1', 1, versionOneContent),
];

function makeVersion(id: string, versionNumber: number, content: string): SkillVersion {
  return {
    id,
    skillId: managedSkill.id,
    versionNumber,
    content,
    contentHash: `hash-${versionNumber}`,
    requiredTools: ['files'],
    permissions: ['read workspace'],
    sourceReferences: [{ kind: 'conversation', id: 'conversation-1', label: 'Weekly review' }],
    validation: validateSkillDraft({ name: managedSkill.slug, description: managedSkill.description, content }),
    changeSummary: `Version ${versionNumber}`,
    candidateId: `candidate-${versionNumber}`,
    createdAt: versionNumber * 100,
    publishedAt: versionNumber * 100,
  };
}

function makeClient(overrides: Partial<SkillLifecycleClient> = {}): SkillLifecycleClient {
  return {
    listCandidates: vi.fn(async () => ({ candidates: [], total: 0 })),
    getCandidate: vi.fn(async () => null),
    submitCandidate: vi.fn(),
    updateCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
    listManagedSkills: vi.fn(async () => ({ skills: [managedSkill], total: 1 })),
    getManagedSkill: vi.fn(async () => managedSkill),
    listVersions: vi.fn(async () => ({ versions, total: versions.length })),
    getVersion: vi.fn(async (id) => versions.find((version) => version.id === id) ?? null),
    publishCandidate: vi.fn(),
    rollback: vi.fn(),
    updateState: vi.fn(),
    getStatus: vi.fn(async () => ({ pendingCount: 0, activeCount: 1, disabledCount: 0 })),
    ...overrides,
  };
}

const verifiedPublication = {
  skill: {
    name: managedSkill.slug,
    description: managedSkill.description,
    location: 'C:\\skills\\weekly-report',
    is_auto_inject: false,
    is_custom: true,
    source: 'custom' as const,
  },
  stagingPath: 'C:\\work\\searcht-skill-staging\\SKILL.md',
  installedNew: false,
};

function passthroughPublisher(onDraft?: (content: string) => void): ManagedSkillPublisher {
  return async (draft, commit) => {
    onDraft?.(draft.content);
    return { ...verifiedPublication, commitResult: await commit(verifiedPublication) };
  };
}

describe('managed skill version history', () => {
  it('shows immutable managed versions and previews their content', async () => {
    render(
      <SkillVersionHistory
        managedSkill={managedSkill}
        client={makeClient()}
        publish={passthroughPublisher()}
        removeSkill={vi.fn()}
      />
    );

    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(screen.getByTestId('skill-version-version-2')).toHaveTextContent('Active');

    await userEvent.click(screen.getByTestId('skill-version-preview-version-1'));
    expect(within(await screen.findByRole('dialog')).getByText(/Create version one/)).toBeInTheDocument();
  });

  it('requires confirmation before disabling and commits only after runtime removal', async () => {
    const events: string[] = [];
    const removeSkill = vi.fn(async () => {
      events.push('remove');
    });
    const disabled = { ...managedSkill, state: 'disabled' as const, updatedAt: 300 };
    const updateState = vi.fn<SkillLifecycleClient['updateState']>(async () => {
      events.push('commit');
      return disabled;
    });
    render(
      <SkillVersionHistory
        managedSkill={managedSkill}
        client={makeClient({ updateState })}
        publish={passthroughPublisher()}
        removeSkill={removeSkill}
      />
    );

    await userEvent.click(await screen.findByTestId('skill-managed-disable'));
    expect(removeSkill).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(updateState).toHaveBeenCalledWith({ skillId: managedSkill.id, state: 'disabled' }));
    expect(events).toEqual(['remove', 'commit']);
    expect(screen.getByTestId('skill-managed-state')).toHaveTextContent('Disabled');
  });

  it('reinstalls the active version before enabling the managed skill', async () => {
    const disabled = { ...managedSkill, state: 'disabled' as const };
    const installed: string[] = [];
    const updateState = vi.fn<SkillLifecycleClient['updateState']>(async () => managedSkill);
    render(
      <SkillVersionHistory
        managedSkill={disabled}
        client={makeClient({ updateState })}
        publish={passthroughPublisher((content) => installed.push(content))}
        removeSkill={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByTestId('skill-managed-enable'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(updateState).toHaveBeenCalledWith({ skillId: managedSkill.id, state: 'active' }));
    expect(installed).toEqual([versionTwoContent]);
  });

  it('imports a historical version before recording rollback as a new version', async () => {
    const versionThree = makeVersion('version-3', 3, versionOneContent);
    const rollbackResult: SkillPublishResult = {
      skill: { ...managedSkill, activeVersionId: versionThree.id, updatedAt: 300 },
      version: versionThree,
    };
    const rollback = vi.fn<SkillLifecycleClient['rollback']>(async () => rollbackResult);
    const installed: string[] = [];
    render(
      <SkillVersionHistory
        managedSkill={managedSkill}
        client={makeClient({ rollback })}
        publish={passthroughPublisher((content) => installed.push(content))}
        removeSkill={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByTestId('skill-version-rollback-version-1'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Roll back' }));

    await waitFor(() => expect(rollback).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version-1' })));
    expect(installed[0]).toBe(versionOneContent);
    expect(await screen.findByText('Version 3')).toBeInTheDocument();
  });

  it('restores the previous runtime content when rollback commit fails', async () => {
    let runtimeContent = versionTwoContent;
    const rollback = vi.fn<SkillLifecycleClient['rollback']>(async () => Promise.reject(new Error('ROLLBACK_FAILED')));
    const publish: ManagedSkillPublisher = async (draft, commit) => {
      runtimeContent = draft.content;
      return { ...verifiedPublication, commitResult: await commit(verifiedPublication) };
    };
    render(
      <SkillVersionHistory
        managedSkill={managedSkill}
        client={makeClient({ rollback })}
        publish={publish}
        removeSkill={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByTestId('skill-version-rollback-version-1'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Roll back' }));

    expect(await screen.findByTestId('skill-version-error')).toBeInTheDocument();
    expect(runtimeContent).toBe(versionTwoContent);
    expect(screen.getByTestId('skill-version-version-2')).toHaveTextContent('Active');
  });
});
