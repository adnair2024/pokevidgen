// This test is the only place the video package touches `core`: the video reads run JSON and defines its own
// schema, so this checks the two never drift apart. Nothing under src/ imports core.
import { describe, expect, it } from 'vitest';
import { buildRun, cacheDir, exists, getGame, loadPlannerData, planIngameTeam } from '@pokevidgen/core';
import { RunSchema } from './run.js';
import { buildTimeline } from './timeline.js';

const hasCache = await exists(cacheDir('pokeapi', 'encounters'));

describe.skipIf(!hasCache)('run files written by core (needs `pnpm data:sync`)', () => {
  it('validate against the video\'s own schema, build a sane timeline, and keep every sprite the picks need', async () => {
    for (const gameId of ['red', 'blue']) {
      const data = await loadPlannerData(getGame(gameId));
      for (const seed of [1, 2, 3, 4]) {
        const run = await buildRun(data, await planIngameTeam(data, { seed }));
        const parsed = RunSchema.parse(JSON.parse(JSON.stringify(run)));
        expect(parsed.picks).toHaveLength(run.picks.length);

        const timeline = buildTimeline(parsed, 30);
        expect(timeline.beats).toHaveLength(parsed.picks.length);
        const seconds = timeline.durationInFrames / 30;
        expect(seconds, `${gameId} seed ${seed}`).toBeGreaterThan(55);
        expect(seconds, `${gameId} seed ${seed}`).toBeLessThan(80);

        for (const pick of parsed.picks) {
          expect(await exists(cacheDir('sprites', `${pick.dex}.png`)), `sprite for ${pick.name}`).toBe(true);
          expect(pick.types.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
