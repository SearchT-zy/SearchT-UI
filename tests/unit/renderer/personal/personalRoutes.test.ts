import { describe, expect, it } from 'vitest';
import { PERSONAL_ROUTES } from '@renderer/pages/personal';

describe('personal workspace routes', () => {
  it('defines every personal module exactly once', () => {
    expect(PERSONAL_ROUTES.map((route) => route.path)).toEqual([
      '/today',
      '/inbox',
      '/calendar',
      '/tasks',
      '/notes',
      '/knowledge',
      '/workflows',
    ]);
    expect(new Set(PERSONAL_ROUTES.map((route) => route.id)).size).toBe(7);
  });
});
