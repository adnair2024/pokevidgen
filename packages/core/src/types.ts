import { z } from 'zod';

/** Every name is stored as a pkmn ID (`toID`): lowercase alphanumerics only. */
export const IdSchema = z.string().regex(/^[a-z0-9]+$/);

export const StatsSchema = z.object({
  hp: z.number().int().min(0),
  atk: z.number().int().min(0),
  def: z.number().int().min(0),
  spa: z.number().int().min(0),
  spd: z.number().int().min(0),
  spe: z.number().int().min(0),
});
export type Stats = z.infer<typeof StatsSchema>;

export const SetSchema = z.object({
  species: IdSchema,
  level: z.number().int().min(1).max(100).default(100),
  item: IdSchema.optional(),
  ability: IdSchema.optional(),
  nature: z.string().optional(),
  teraType: z.string().optional(),
  evs: StatsSchema.partial().optional(),
  ivs: StatsSchema.partial().optional(),
  moves: z.array(IdSchema).min(1).max(4),
});
export type PokemonSet = z.infer<typeof SetSchema>;

export const MoveSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('level'), level: z.number().int() }),
  z.object({ kind: z.literal('tm'), number: z.number().int(), move: IdSchema }),
  z.object({ kind: z.literal('hm'), number: z.number().int(), move: IdSchema }),
  z.object({ kind: z.literal('tutor') }),
  z.object({ kind: z.literal('egg') }),
]);
export type MoveSource = z.infer<typeof MoveSourceSchema>;

export const MemberSchema = z.object({
  set: SetSchema,
  roles: z.array(z.string()).default([]),
  /** In-game only: where/when this Pokémon (and each move) is obtained. */
  acquisition: z
    .object({
      location: z.string(),
      minBadges: z.number().int().min(0),
      method: z.enum(['wild', 'gift', 'trade', 'evolve', 'egg', 'static']),
      moveSources: z.record(IdSchema, MoveSourceSchema).default({}),
    })
    .optional(),
});
export type Member = z.infer<typeof MemberSchema>;

export const TeamSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['ingame', 'showdown']),
    /** Game id (e.g. "crystal") for in-game teams, format id (e.g. "gen9ou") for competitive. */
    target: z.string(),
    seed: z.number().int().optional(),
    members: z.array(MemberSchema).min(1).max(6),
    analysis: z.record(z.unknown()).default({}),
  });
export type Team = z.infer<typeof TeamSchema>;
