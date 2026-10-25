import { z } from 'zod';
import { IdSchema } from '../types.js';
import { StageSchema } from './progression-schema.js';

export const TmSourceSchema = z.object({
  /** ground = pickup item; npc = reward, gift or trade from a character on that map; shop; prize = Game Corner. */
  kind: z.enum(['ground', 'npc', 'shop', 'prize']),
  location: z.string(),
  /** Badges typically held when you first get it (hand-assigned, same scale as progression.json). */
  stage: StageSchema,
});

export const TmEntrySchema = z.object({
  kind: z.enum(['tm', 'hm']),
  number: z.number().int().min(1).max(50),
  move: IdSchema,
  sources: z.array(TmSourceSchema).min(1),
});
export type TmEntry = z.infer<typeof TmEntrySchema>;

export const TmsFileSchema = z.object({
  source: z.object({ repo: z.string(), commit: z.string(), note: z.string() }),
  tms: z.array(TmEntrySchema),
});
export type TmsFile = z.infer<typeof TmsFileSchema>;
