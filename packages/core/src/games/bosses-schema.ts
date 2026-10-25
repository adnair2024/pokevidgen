import { z } from 'zod';
import { IdSchema } from '../types.js';

export const BossMonSchema = z.object({
  species: IdSchema,
  level: z.number().int().min(1).max(100),
  /** Move IDs, derived from the game's own learnset rules plus its special-move tables. */
  moves: z.array(IdSchema).min(1).max(4),
});

export const BossVariantSchema = z.object({
  /** Rival teams depend on the rival's starter; unset when the team is fixed. */
  rivalStarter: z.enum(['squirtle', 'bulbasaur', 'charmander']).optional(),
  team: z.array(BossMonSchema).min(1).max(6),
});

export const BossSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['gymLeader', 'eliteFour', 'rival', 'villain']),
  location: z.string(),
  /** Badge awarded (gym leaders only). */
  badge: z.string().optional(),
  /** Story order, 1-based; used for level caps and "when do I face this". */
  order: z.number().int(),
  variants: z.array(BossVariantSchema).min(1),
});
export type Boss = z.infer<typeof BossSchema>;

export const BossesFileSchema = z.object({
  source: z.object({
    repo: z.string(),
    commit: z.string(),
    paths: z.array(z.string()),
    note: z.string(),
  }),
  /** The rival's starter, keyed by the player's starter (verified in pokered/scripts/OaksLab.asm). */
  rivalStarterFor: z.record(z.enum(['squirtle', 'bulbasaur', 'charmander'])),
  bosses: z.array(BossSchema),
});
export type BossesFile = z.infer<typeof BossesFileSchema>;
