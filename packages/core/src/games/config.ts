import { z } from 'zod';

export const GameConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Used in narration, e.g. "Can this Kanto team beat the Elite Four?" */
  region: z.string(),
  /** Generation number for every Dex lookup; never read from anywhere else. */
  generation: z.number().int().min(1).max(9),
  /** PokeAPI version name whose encounters this game uses. */
  pokeApiVersion: z.string(),
  /** Folder under data/curated/ holding this game's bosses and progression. */
  curated: z.string(),
});
export type GameConfig = z.infer<typeof GameConfigSchema>;
