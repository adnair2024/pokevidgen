import { describe, expect, it } from 'vitest';
import { SetSchema } from './types.js';

describe('SetSchema', () => {
  it('accepts a minimal set and defaults the level', () => {
    const set = SetSchema.parse({ species: 'pikachu', moves: ['thunderbolt'] });
    expect(set.level).toBe(100);
  });

  it('rejects display-name species (must be a toID)', () => {
    expect(SetSchema.safeParse({ species: 'Mr. Mime', moves: ['psychic'] }).success).toBe(false);
  });
});
