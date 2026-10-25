import type { WordFrames } from './timeline.js';

/**
 * Word timings when there's no voice manifest: spread the line's words across the window in proportion
 * to their length. A voice manifest (real timings from the audio) replaces this entirely.
 */
export const estimateWords = (text: string, startFrame: number, endFrame: number): WordFrames[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.reduce((s, w) => s + w.length + 1, 0);
  let at = startFrame;
  return words.map((word, i) => {
    const end = i === words.length - 1 ? endFrame : at + Math.round(((word.length + 1) / total) * (endFrame - startFrame));
    const out = { word, startFrame: at, endFrame: Math.max(end, at + 1) };
    at = out.endFrame;
    return out;
  });
};

/** Chunks of 3 words, never leaving a lone word at the end (it joins the previous chunk: 2-4 words per chunk). */
export const chunkWords = (words: WordFrames[], size = 3): WordFrames[][] => {
  const chunks: WordFrames[][] = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size));
  if (chunks.length > 1 && chunks[chunks.length - 1]!.length === 1) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1]!.push(...last);
  }
  return chunks;
};

/** The chunk to show at `frame`, and which word in it is being spoken. Nothing before the first or after the last word. */
export const captionAt = (words: WordFrames[], frame: number): { chunk: WordFrames[]; active: number } | undefined => {
  if (words.length === 0 || frame < words[0]!.startFrame || frame > words[words.length - 1]!.endFrame) return undefined;
  const chunks = chunkWords(words);
  const chunk = chunks.find((c) => frame <= c[c.length - 1]!.endFrame) ?? chunks[chunks.length - 1]!;
  const spoken = chunk.findIndex((w) => frame >= w.startFrame && frame < w.endFrame);
  // Between words, keep the last spoken one lit rather than flashing nothing.
  const last = chunk.reduce((acc, w, i) => (w.startFrame <= frame ? i : acc), 0);
  return { chunk, active: spoken >= 0 ? spoken : last };
};
