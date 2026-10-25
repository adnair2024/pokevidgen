import { readdir } from 'node:fs/promises';
import { BossesFileSchema, type BossesFile } from '../games/bosses-schema.js';
import type { GameConfig } from '../games/config.js';
import { PronunciationsFileSchema, type PronunciationsFile } from '../games/pronunciations-schema.js';
import { LearnsetsFileSchema, type LearnsetsFile } from '../games/learnsets-schema.js';
import { TmsFileSchema, type TmsFile } from '../games/tms-schema.js';
import { ProgressionFileSchema, type ProgressionFile } from '../games/progression-schema.js';
import { cacheDir, curatedDir, exists, readCache } from './cache.js';
import { EncountersFileSchema, SpeciesFileSchema, type EncountersFile, type SpeciesFile } from './schemas.js';

/** All cached encounter files, one per species. Errors with a hint if `data:sync` hasn't run. */
export const loadEncounters = async (): Promise<EncountersFile[]> => {
  const dir = cacheDir('pokeapi', 'encounters');
  if (!(await exists(dir))) throw new Error('No encounter cache. Run `pnpm data:sync` first.');
  const files = await readdir(dir);
  return Promise.all(files.map((f) => readCache(`${dir}/${f}`, EncountersFileSchema)));
};

export const loadBosses = (game: GameConfig): Promise<BossesFile> =>
  readCache(curatedDir(game.curated, 'bosses.json'), BossesFileSchema);

export const loadProgression = (game: GameConfig): Promise<ProgressionFile> =>
  readCache(curatedDir(game.curated, 'progression.json'), ProgressionFileSchema);

export const loadTms = (game: GameConfig): Promise<TmsFile> =>
  readCache(curatedDir(game.curated, 'tms.json'), TmsFileSchema);

export const loadLearnsets = (game: GameConfig): Promise<LearnsetsFile> =>
  readCache(curatedDir(game.curated, 'learnsets.json'), LearnsetsFileSchema);

export const loadPronunciations = (): Promise<PronunciationsFile> =>
  readCache(curatedDir('pronunciations.json'), PronunciationsFileSchema);

/** PokeAPI species data (genus, height, weight) for one Pokédex number, if it has been synced. */
export const loadSpeciesInfo = async (dex: number): Promise<SpeciesFile | undefined> => {
  const path = cacheDir('pokeapi', 'species', `${dex}.json`);
  return (await exists(path)) ? readCache(path, SpeciesFileSchema) : undefined;
};
