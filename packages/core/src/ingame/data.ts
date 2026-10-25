import type { Generation } from '@pkmn/data';
import { forGen } from '../data/gens.js';
import { loadBosses, loadEncounters, loadLearnsets, loadProgression, loadTms } from '../data/loaders.js';
import type { EncountersFile } from '../data/schemas.js';
import type { BossesFile } from '../games/bosses-schema.js';
import type { GameConfig } from '../games/config.js';
import type { LearnsetsFile } from '../games/learnsets-schema.js';
import type { ProgressionFile } from '../games/progression-schema.js';
import type { TmsFile } from '../games/tms-schema.js';

/** Everything the in-game planner reads, loaded once. */
export type PlannerData = {
  game: GameConfig;
  gen: Generation;
  encounters: EncountersFile[];
  progression: ProgressionFile;
  bosses: BossesFile;
  tms: TmsFile;
  learnsets: LearnsetsFile;
};

export const loadPlannerData = async (game: GameConfig): Promise<PlannerData> => {
  const [encounters, progression, bosses, tms, learnsets] = await Promise.all([
    loadEncounters(), loadProgression(game), loadBosses(game), loadTms(game), loadLearnsets(game),
  ]);
  return { game, gen: forGen(game.generation as Parameters<typeof forGen>[0]), encounters, progression, bosses, tms, learnsets };
};
