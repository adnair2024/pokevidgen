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
  /** Learned by level-up; `from` is the species that learns it (a pre-evolution, or the member itself). */
  z.object({ kind: z.literal('level'), level: z.number().int(), from: IdSchema }),
  /** Known the moment the Pokémon is obtained (the game's last-four rule at its starting level). */
  z.object({ kind: z.literal('start'), from: IdSchema }),
  z.object({ kind: z.literal('tm'), number: z.number().int(), location: z.string() }),
  z.object({ kind: z.literal('hm'), number: z.number().int(), location: z.string() }),
]);
export type MoveSource = z.infer<typeof MoveSourceSchema>;

export const MoveLearnSchema = z.object({
  move: IdSchema,
  source: MoveSourceSchema,
  /** Stage (badges held; 9 = after the Elite Four) at which this move can first be taught. */
  stage: z.number().int().min(0).max(9),
});
export type MoveLearn = z.infer<typeof MoveLearnSchema>;

export const AcquisitionStepSchema = z.object({
  species: IdSchema,
  how: z.enum(['wild', 'surf', 'rod', 'gift', 'static', 'trade', 'prize', 'purchase', 'fossil', 'evolution']),
  /** Human-readable place or method ("Viridian Forest", "Thunder Stone from Celadon Dept. Store 4F"). */
  where: z.string(),
  minLevel: z.number().int().optional(),
  maxLevel: z.number().int().optional(),
  stage: z.number().int().min(0).max(9),
  /** Structured details, so narration never has to parse `where`. */
  place: z.string().optional(),
  price: z.number().int().optional(),
  coins: z.number().int().optional(),
  evolution: z.object({ how: z.enum(['level', 'stone', 'trade']), level: z.number().int().optional(), item: z.string().optional() }).optional(),
});
export type AcquisitionStep = z.infer<typeof AcquisitionStepSchema>;

export const MemberSchema = z.object({
  set: SetSchema,
  roles: z.array(z.string()).default([]),
  /** In-game only: how to get the line from first catch to final form, and when each move is learned. */
  acquisition: z
    .object({
      stage: z.number().int().min(0).max(9),
      steps: z.array(AcquisitionStepSchema).min(1),
      moves: z.array(MoveLearnSchema),
      /** Advice that follows from the plan, e.g. when to hold off evolving. */
      notes: z.array(z.string()).default([]),
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
    /** A video concept this team was built for, e.g. "if your favorite Pokémon is X". */
    theme: z.object({ kind: z.literal('favorite'), species: z.string() }).optional(),
    members: z.array(MemberSchema).min(1).max(6),
    analysis: z.record(z.unknown()).default({}),
  });
export type Team = z.infer<typeof TeamSchema>;
