import type { GameConfig } from './config.js';
import { blue } from './blue.js';
import { red } from './red.js';

const GAMES: Record<string, GameConfig> = { red, blue };

export const gameIds = (): string[] => Object.keys(GAMES);

export const getGame = (id: string): GameConfig => {
  const game = GAMES[id];
  if (!game) throw new Error(`Unknown game "${id}". Known: ${gameIds().join(', ')}`);
  return game;
};

export * from './config.js';
export * from './bosses-schema.js';
export * from './progression-schema.js';
export * from './tms-schema.js';
export * from './learnsets-schema.js';
export * from './pronunciations-schema.js';
