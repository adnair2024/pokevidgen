import { z } from 'zod';

export const PronunciationsFileSchema = z.object({
  source: z.object({ note: z.string() }),
  /** Lowercase word → respelling for the speech engine. Never shown in captions. */
  words: z.record(z.string()),
});
export type PronunciationsFile = z.infer<typeof PronunciationsFileSchema>;
