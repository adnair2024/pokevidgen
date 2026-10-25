import { z } from 'zod';

/** PokeAPI version names we cache encounters for (gen 1). */
export const GEN1_VERSIONS = ['red', 'blue', 'yellow'] as const;
export const Gen1VersionSchema = z.enum(GEN1_VERSIONS);
export type Gen1Version = z.infer<typeof Gen1VersionSchema>;

export const EncounterDetailSchema = z.object({
  method: z.string(),
  minLevel: z.number().int(),
  maxLevel: z.number().int(),
  chance: z.number(),
  conditions: z.array(z.string()),
});

export const EncounterAreaSchema = z.object({
  /** PokeAPI location-area slug, e.g. "kanto-route-2-south-towards-viridian-city". */
  area: z.string(),
  version: Gen1VersionSchema,
  maxChance: z.number(),
  details: z.array(EncounterDetailSchema),
});
export type EncounterArea = z.infer<typeof EncounterAreaSchema>;

export const EncountersFileSchema = z.object({
  dex: z.number().int(),
  species: z.string(),
  areas: z.array(EncounterAreaSchema),
});
export type EncountersFile = z.infer<typeof EncountersFileSchema>;

export const SpeciesFileSchema = z.object({
  dex: z.number().int(),
  species: z.string(),
  genus: z.string(),
  /** Decimetres / hectograms, as PokeAPI reports them. */
  height: z.number(),
  weight: z.number(),
  types: z.array(z.string()),
  /** Relative to data/cache/, e.g. "sprites/25.png". */
  spritePath: z.string().optional(),
});
export type SpeciesFile = z.infer<typeof SpeciesFileSchema>;

/** Smogon sets JSON: format-level shape is loose, so we only check it is an object tree. */
export const SetsFileSchema = z.record(z.record(z.unknown()));
export type SetsFile = z.infer<typeof SetsFileSchema>;
