import { DUCK } from './theme.js';

/** dB to linear gain. */
export const dbToGain = (db: number): number => 10 ** (db / 20);

/**
 * Music volume at a frame: 1 normally, ducked by `DUCK.db` while a narration line plays, with
 * `DUCK.rampMs` ramps into and out of it. Pure, so it can be passed to Remotion's per-frame `volume`.
 */
export const duckVolume = (frame: number, fps: number, windows: ReadonlyArray<{ startFrame: number; endFrame: number }>): number => {
  const ramp = Math.max(1, Math.round((DUCK.rampMs / 1000) * fps));
  const floor = dbToGain(DUCK.db);
  let gain = 1;
  for (const w of windows) {
    let g = 1;
    if (frame >= w.startFrame && frame <= w.endFrame) g = floor;
    else if (frame < w.startFrame && frame >= w.startFrame - ramp) g = 1 - (1 - floor) * ((frame - (w.startFrame - ramp)) / ramp);
    else if (frame > w.endFrame && frame <= w.endFrame + ramp) g = floor + (1 - floor) * ((frame - w.endFrame) / ramp);
    gain = Math.min(gain, g);
  }
  return gain;
};
