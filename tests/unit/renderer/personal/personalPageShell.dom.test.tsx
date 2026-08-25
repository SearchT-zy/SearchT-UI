// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PersonalPageShell from '@renderer/pages/personal/PersonalPageShell';

describe('PersonalPageShell', () => {
  it('includes horizontal padding inside its available width', () => {
    const { container } = render(<PersonalPageShell title='Tasks'>Content</PersonalPageShell>);
    const content = container.querySelector('main > div');

    expect(content).toHaveClass('box-border');
  });
});
