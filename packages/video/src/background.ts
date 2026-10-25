import { DEFAULT_TIMING as T, NEUTRAL_BACKGROUND, typeBackground } from './theme.js';
import type { Run } from './run.js';
import type { Timeline } from './timeline.js';

/**
 * Background colour keyframes: neutral over the hook, shifting to each pick's type colour once its card
 * has left, and back to neutral for the outro. Frames strictly increase, as `interpolateColors` needs.
 */
export const backgroundKeyframes = (timeline: Timeline, run: Run): { frames: number[]; colors: string[] } => {
  const shift = Math.max(2, Math.round(T.bgShift * timeline.fps));
  const frames: number[] = [0];
  const colors: string[] = [NEUTRAL_BACKGROUND];
  const push = (frame: number, color: string) => {
    const at = Math.max(frame, frames[frames.length - 1]! + 1);
    frames.push(at);
    colors.push(color);
  };
  for (const beat of timeline.beats) {
    const from = beat.cardOut + Math.round(T.cardOut * timeline.fps);
    push(from, colors[colors.length - 1]!); // hold the previous colour until the card has gone
    push(from + shift, typeBackground(run.picks[beat.index]!.types[0]));
  }
  push(timeline.outro.start, colors[colors.length - 1]!);
  push(timeline.outro.start + shift, NEUTRAL_BACKGROUND);
  return { frames, colors };
};
