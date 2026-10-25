import { SetsFileSchema, cacheDir, exists, writeCache } from '@pokevidgen/core';
import { fetchJson } from './http.js';

/** Smogon sets for a format, from data.pkmn.cc. Skips if already cached. */
export const syncSets = async (format: string): Promise<boolean> => {
  const path = cacheDir('smogon', 'sets', `${format}.json`);
  if (await exists(path)) return false;
  await writeCache(path, SetsFileSchema.parse(await fetchJson(`https://data.pkmn.cc/sets/${format}.json`)));
  return true;
};
