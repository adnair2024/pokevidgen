import { z } from 'zod';

/**
 * Written to packages/video/public/voice/<run id>/manifest.json. The video reads it for timing and
 * captions; `file` is relative to the video's public folder, as `staticFile()` wants.
 */
export const ManifestSchema = z.object({
  settings: z.object({ engine: z.string(), model: z.string(), voice: z.string(), speed: z.number(), respell: z.boolean() }).optional(),
  lines: z.array(
    z.object({
      /** "hook", "outro", or a pick's Pokémon id. */
      key: z.string(),
      file: z.string(),
      durationMs: z.number().int().nonnegative(),
      words: z.array(z.object({ word: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() })),
    }),
  ),
});
export type Manifest = z.infer<typeof ManifestSchema>;
