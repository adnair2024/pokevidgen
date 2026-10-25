import { z } from 'zod';

/**
 * The run file as the video reads it. This is deliberately its own schema, not an import from `core`:
 * the video only consumes run JSON. Extra fields (such as `facts`) are ignored.
 */
export const IntroSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gymLeader'), name: z.string(), title: z.string(), types: z.array(z.string()), sprite: z.string().optional() }),
  z.object({ kind: z.literal('tm'), move: z.string(), moveName: z.string(), number: z.number().int(), moveType: z.string(), location: z.string() }),
  z.object({ kind: z.literal('pokedex'), genus: z.string().optional(), heightM: z.number().optional(), weightKg: z.number().optional() }),
]);
export type Intro = z.infer<typeof IntroSchema>;

export const PickSchema = z.object({
  pokemon: z.string(),
  name: z.string(),
  types: z.array(z.string()).min(1),
  dex: z.number().int(),
  intro: IntroSchema,
  line: z.object({ text: z.string(), factIds: z.array(z.string()).default([]) }),
  effect: z.string().nullable().default(null),
});
export type Pick = z.infer<typeof PickSchema>;

export const RunSchema = z.object({
  id: z.string(),
  title: z.string(),
  music: z.string().nullable().default(null),
  voiceover: z.object({ hook: z.string(), outro: z.string() }),
  picks: z.array(PickSchema).min(1).max(6),
});
export type Run = z.infer<typeof RunSchema>;

/** Voice manifest: one entry per narration line, written by the voice step (`pnpm voice generate`). */
export const ManifestSchema = z.object({
  lines: z.array(
    z.object({
      /** "hook", "outro", or a pick's Pokémon id. */
      key: z.string(),
      file: z.string(),
      durationMs: z.number().int().nonnegative(),
      words: z.array(z.object({ word: z.string(), startMs: z.number(), endMs: z.number() })),
    }),
  ),
});
export type Manifest = z.infer<typeof ManifestSchema>;
