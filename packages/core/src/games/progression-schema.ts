import { z } from 'zod';

/** 0-8 = badges typically held on arrival; 9 = after the Elite Four. */
export const StageSchema = z.number().int().min(0).max(9);

export const ProgressionFileSchema = z.object({
  source: z.object({ note: z.string() }),
  badgeOrder: z.array(z.string()),
  /** Extra stage needed to use an encounter method (rods, Surf), on top of the area's stage. */
  methods: z.record(StageSchema),
  /** At most one species line from each group can be obtained in a single playthrough. */
  exclusiveGroups: z.array(z.object({ id: z.string(), reason: z.string(), species: z.array(z.string()) })),
  /** Fixes to PokeAPI's encounter data, each verified against the game source. */
  corrections: z.object({
    purchases: z.array(z.object({ species: z.string(), area: z.string(), price: z.number().int(), where: z.string() })),
    removedSources: z.array(z.object({ species: z.string(), area: z.string(), reason: z.string() })),
  }),
  areas: z.record(z.object({ stage: StageSchema })),
  /** Evolution items and where they first become obtainable. */
  items: z.record(z.object({ stage: StageSchema, source: z.string(), /** Absent when the item is sold (unlimited). */ quantity: z.number().int().optional() })),
});
export type ProgressionFile = z.infer<typeof ProgressionFileSchema>;
