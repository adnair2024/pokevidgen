import { randomInt } from 'node:crypto';
import { TeamSchema, type Team } from './types.js';
import { buildRun, type Run } from './export/run.js';
import { planIngameTeam, type PlannerInput } from './ingame/planner.js';
import type { PlannerData } from './ingame/data.js';

export type MakeOptions = Omit<PlannerInput, 'seed'> & { seed?: number };

/** Team in, script out: plan a team (random seed if none is given) and write its narration. Voice and render come after. */
export const prepareMake = async (data: PlannerData, opts: MakeOptions = {}): Promise<{ team: Team; run: Run; seed: number }> => {
  const seed = opts.seed ?? randomInt(1, 2 ** 31);
  const team = TeamSchema.parse(await planIngameTeam(data, { ...opts, seed }));
  return { team, run: await buildRun(data, team), seed };
};

/** Voice settings as the CLI takes them; the dashboard's `VoiceSettings` has the same shape. */
export type VoiceArgs = { engine: string; voice: string; speed: number; respell: boolean };

/** `pnpm voice generate` arguments. The caller validates engine, voice and speed. */
export const voiceSteps = (runId: string, s: VoiceArgs): string[][] => [
  ['voice', 'generate', `runs/${runId}.json`, '--engine', s.engine, '--voice', s.voice, '--speed', String(s.speed), ...(s.respell ? [] : ['--no-respell'])],
];
export const voicePreviewSteps = (runId: string): string[][] => [['voice', 'preview', `runs/${runId}.json`]];

export type RenderMode = 'preview' | 'full' | 'still';
export const isRenderMode = (s: string): s is RenderMode => s === 'preview' || s === 'full' || s === 'still';

/** The `pnpm` arguments for a render. The run id and frame are validated by the caller. */
export const renderSteps = (runId: string, mode: RenderMode, frame = 0, withVoice = false): string[][] => {
  const run = `runs/${runId}.json`;
  const voice = withVoice ? ['--manifest', `packages/video/public/voice/${runId}/manifest.json`] : [];
  if (mode === 'still') return [['video', 'render', run, '--still', String(frame), '--scale', '0.5', ...voice, '--out', `out/${runId}-frame${frame}.png`]];
  if (mode === 'preview') return [['video', 'render', run, '--scale', '0.5', ...voice, '--out', `out/${runId}-preview.mp4`]];
  return [['video', 'render', run, ...voice, '--out', `out/${runId}.mp4`]];
};

/** Everything after the script: narration, then the render timed to it. */
export const makeSteps = (runId: string, voice: VoiceArgs, mode: Exclude<RenderMode, 'still'> = 'full'): string[][] => [
  ...voiceSteps(runId, voice),
  ...renderSteps(runId, mode, 0, true),
];
