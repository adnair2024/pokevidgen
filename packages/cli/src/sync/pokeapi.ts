import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  GEN1_VERSIONS,
  cacheDir,
  exists,
  writeCache,
  type EncountersFile,
  type SpeciesFile,
} from '@pokevidgen/core';
import { fetchJson, throttledFetch } from './http.js';

const API = 'https://pokeapi.co/api/v2';
const GEN1_DEX = 151;

const named = z.object({ name: z.string() });

const EncountersResponse = z.array(
  z.object({
    location_area: named,
    version_details: z.array(
      z.object({
        version: named,
        max_chance: z.number(),
        encounter_details: z.array(
          z.object({
            min_level: z.number(),
            max_level: z.number(),
            chance: z.number(),
            method: named,
            condition_values: z.array(named),
          }),
        ),
      }),
    ),
  }),
);

const PokemonResponse = z.object({
  name: z.string(),
  height: z.number(),
  weight: z.number(),
  types: z.array(z.object({ type: named })),
  sprites: z.object({
    front_default: z.string().nullable(),
    versions: z
      .object({
        'generation-i': z.object({
          'red-blue': z.object({ front_default: z.string().nullable(), front_transparent: z.string().nullable().optional() }),
        }),
      })
      .partial()
      .optional(),
  }),
});

const SpeciesResponse = z.object({
  genera: z.array(z.object({ genus: z.string(), language: named })),
});

const isGen1Version = (v: string): v is (typeof GEN1_VERSIONS)[number] =>
  (GEN1_VERSIONS as readonly string[]).includes(v);

export const syncEncounters = async (): Promise<number> => {
  let fetched = 0;
  for (let dex = 1; dex <= GEN1_DEX; dex++) {
    const path = cacheDir('pokeapi', 'encounters', `${dex}.json`);
    if (await exists(path)) continue;
    const raw = EncountersResponse.parse(await fetchJson(`${API}/pokemon/${dex}/encounters`));
    const areas: EncountersFile['areas'] = raw.flatMap((entry) =>
      entry.version_details.flatMap((vd) =>
        isGen1Version(vd.version.name)
          ? [
              {
                area: entry.location_area.name,
                version: vd.version.name,
                maxChance: vd.max_chance,
                details: vd.encounter_details.map((d) => ({
                  method: d.method.name,
                  minLevel: d.min_level,
                  maxLevel: d.max_level,
                  chance: d.chance,
                  conditions: d.condition_values.map((c) => c.name),
                })),
              },
            ]
          : [],
      ),
    );
    const species = PokemonResponse.parse(await fetchJson(`${API}/pokemon/${dex}`)).name;
    await writeCache(path, { dex, species, areas } satisfies EncountersFile);
    fetched++;
  }
  return fetched;
};

export const syncSpecies = async (): Promise<number> => {
  let fetched = 0;
  for (let dex = 1; dex <= GEN1_DEX; dex++) {
    const path = cacheDir('pokeapi', 'species', `${dex}.json`);
    if (await exists(path)) continue;
    const poke = PokemonResponse.parse(await fetchJson(`${API}/pokemon/${dex}`));
    const species = SpeciesResponse.parse(await fetchJson(`${API}/pokemon-species/${dex}`));
    const genus = species.genera.find((g) => g.language.name === 'en')?.genus ?? '';

    // Prefer the transparent version: front_default has an opaque white background that shows up on coloured pages.
    const redBlue = poke.sprites.versions?.['generation-i']?.['red-blue'];
    const spriteUrl = redBlue?.front_transparent ?? redBlue?.front_default ?? poke.sprites.front_default;
    let spritePath: string | undefined;
    if (spriteUrl) {
      spritePath = join('sprites', `${dex}.png`);
      const file = cacheDir(spritePath);
      if (!(await exists(file))) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(await (await throttledFetch(spriteUrl)).arrayBuffer()));
      }
    }

    await writeCache(path, {
      dex,
      species: poke.name,
      genus,
      height: poke.height,
      weight: poke.weight,
      types: poke.types.map((t) => t.type.name),
      spritePath,
    } satisfies SpeciesFile);
    fetched++;
  }
  return fetched;
};
