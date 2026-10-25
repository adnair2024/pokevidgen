import { z } from 'zod';
import { IdSchema } from '../types.js';

export const SpeciesLearnsetSchema = z.object({
  /** Moves a Pokémon of this species starts with at level 1 (pokered base stats). */
  start: z.array(IdSchema),
  /** Level-up moves in the game's order (ascending level). */
  levelUp: z.array(z.object({ level: z.number().int(), move: IdSchema })),
  /** Moves it can learn from TMs and HMs. */
  tmhm: z.array(IdSchema),
});
export type SpeciesLearnset = z.infer<typeof SpeciesLearnsetSchema>;

export const LearnsetsFileSchema = z.object({
  source: z.object({ repo: z.string(), commit: z.string(), note: z.string() }),
  species: z.record(SpeciesLearnsetSchema),
});
export type LearnsetsFile = z.infer<typeof LearnsetsFileSchema>;
