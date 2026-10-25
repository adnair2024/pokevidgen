import { describe, expect, it } from 'vitest';
import { forGen } from './gens.js';
import { toID } from './ids.js';

describe('toID', () => {
  it('normalizes display names', () => {
    expect(toID('Mr. Mime')).toBe('mrmime');
    expect(toID('nidoran-f')).toBe('nidoranf');
  });
});

describe('forGen', () => {
  it('gen 1 has no Fairy type, abilities or items', () => {
    const gen1 = forGen(1);
    expect(gen1.types.get('Fairy')).toBeUndefined();
    expect(gen1.abilities.get('Overgrow')).toBeUndefined();
    expect(gen1.items.get('Leftovers')).toBeUndefined();
  });

  it('gen 1 Ghost moves have no effect on Psychic (the famous gen 1 bug)', () => {
    // damageTaken codes: 0 neutral, 1 super effective, 2 resisted, 3 immune.
    expect(forGen(1).dex.types.get('Psychic').damageTaken['Ghost']).toBe(3);
  });

  it('gen 1 Pikachu has a single Special stat', () => {
    const pika = forGen(1).species.get('Pikachu');
    expect(pika?.baseStats.spa).toBe(pika?.baseStats.spd);
  });
});
