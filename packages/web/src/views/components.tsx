import type { FC } from 'hono/jsx';

export const TypeChip: FC<{ type: string }> = ({ type }) => (
  <span class={`type type-${type.toLowerCase()}`}>{type}</span>
);

/** Pixel sprite; the server answers 404 until `pnpm data:sync` has fetched it, and the alt text shows instead. */
export const Sprite: FC<{ species: string; size?: number }> = ({ species, size = 2 }) => (
  <img class="sprite" src={`/sprites/${species}.png`} alt={species} width={56 * size} height={56 * size} loading="lazy" />
);

export const Notice: FC<{ kind: 'error' | 'info' | 'warn'; children?: unknown }> = ({ kind, children }) => (
  <div class={`notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>
);

export { stageLabel } from '@pokevidgen/core';
