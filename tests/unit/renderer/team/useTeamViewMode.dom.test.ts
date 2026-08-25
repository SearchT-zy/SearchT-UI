// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTeamViewMode } from '@renderer/pages/team/hooks/useTeamViewMode';

describe('useTeamViewMode', () => {
  beforeEach(() => localStorage.clear());

  it('uses group view when the team has no stored preference', () => {
    const { result } = renderHook(() => useTeamViewMode('team-1'));
    expect(result.current[0]).toBe('group');
  });

  it.each(['group', 'parallel', 'single', 'board'] as const)('preserves the stored %s view', (mode) => {
    localStorage.setItem('team-view-mode-team-1', mode);
    const { result } = renderHook(() => useTeamViewMode('team-1'));
    expect(result.current[0]).toBe(mode);
  });

  it('migrates the legacy flow view to board', () => {
    localStorage.setItem('team-view-mode-team-1', 'flow');
    const { result } = renderHook(() => useTeamViewMode('team-1'));
    expect(result.current[0]).toBe('board');
  });

  it('stores a selected group view for the current team', () => {
    const { result } = renderHook(() => useTeamViewMode('team-1'));
    act(() => result.current[1]('group'));
    expect(localStorage.getItem('team-view-mode-team-1')).toBe('group');
  });
});
