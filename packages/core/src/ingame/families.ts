import type { Generation } from '@pkmn/data';
import { toID } from '../data/ids.js';

/** Root-to-species chain of pre-evolutions, e.g. charizard → [charmander, charmeleon, charizard]. */
export const chainOf = (gen: Generation, id: string): string[] => {
  const chain = [id];
  for (let s = gen.species.get(id); s?.prevo; s = gen.species.get(toID(s.prevo))) chain.unshift(toID(s.prevo));
  return chain;
};

export type EvolutionStep = { from: string; to: string; how: 'level' | 'stone' | 'trade'; level?: number; item?: string };

/** How `to` evolves from its pre-evolution in this generation, or undefined if it doesn't (or by a method we don't model). */
export const evolutionInto = (gen: Generation, to: string): EvolutionStep | undefined => {
  const s = gen.species.get(to);
  if (!s?.prevo) return undefined;
  const from = toID(s.prevo);
  if (s.evoType === 'useItem' && s.evoItem) return { from, to, how: 'stone', item: toID(s.evoItem) };
  if (s.evoType === 'trade') return { from, to, how: 'trade' };
  if (s.evoLevel && !s.evoType) return { from, to, how: 'level', level: s.evoLevel };
  return undefined;
};

/** Every species a given species can evolve into directly. */
export const evolutionsOf = (gen: Generation, id: string): string[] =>
  (gen.species.get(id)?.evos ?? []).map(toID);
