import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { repoDir } from '@pokevidgen/core';

export type Job = { id: string; label: string; status: 'running' | 'done' | 'failed'; log: string[]; startedAt: number; teamId?: string };

/** Only these commands can be started from the dashboard; nothing from the request becomes an argument. */
export const JOBS = {
  'sync-all': { label: 'Sync all data (PokeAPI + Smogon)', steps: [['data:sync']] },
  'sync-encounters': { label: 'Sync encounters', steps: [['data:sync', '--only', 'encounters']] },
  'sync-species': { label: 'Sync species and sprites', steps: [['data:sync', '--only', 'species']] },
  'sync-sets': { label: 'Sync Smogon sets', steps: [['data:sync', '--only', 'sets']] },
  'voice-setup': { label: 'Set up voice (Python environment and about 500 MB of models)', steps: [['voice', 'setup']] },
  'import-gen1': {
    label: 'Re-import Gen 1 curated data from pokered',
    steps: ['learnsets', 'bosses', 'tms'].map((n) => ['--filter', '@pokevidgen/cli', 'exec', 'tsx', `src/curated/import-gen1-${n}.ts`]),
  },
} as const satisfies Record<string, { label: string; steps: ReadonlyArray<readonly string[]> }>;
export type JobName = keyof typeof JOBS;

export { isRenderMode, renderSteps, voicePreviewSteps, voiceSteps, type RenderMode } from '@pokevidgen/core';

export const isJobName = (s: string): s is JobName => s in JOBS;

/** `onFinish` runs when a job ends, so callers can drop caches built from data the job just changed. */
export const createJobs = (onFinish: () => void = () => {}) => {
  const jobs = new Map<string, Job>();

  const start = (name: JobName, teamId?: string): Job => startSteps(JOBS[name].label, JOBS[name].steps, teamId);

  const startSteps = (label: string, steps: ReadonlyArray<readonly string[]>, teamId?: string): Job => {
    const job: Job = { id: randomUUID(), label, status: 'running', log: [], startedAt: Date.now(), teamId };
    jobs.set(job.id, job);

    const run = (steps: ReadonlyArray<readonly string[]>): void => {
      const [step, ...rest] = steps;
      if (!step) { job.status = 'done'; onFinish(); return; }
      job.log.push(`$ pnpm ${step.join(' ')}`);
      const child = spawn('pnpm', [...step], { cwd: repoDir() });
      const push = (chunk: Buffer) => job.log.push(...chunk.toString().split('\n').filter(Boolean));
      child.stdout.on('data', push);
      child.stderr.on('data', push);
      child.on('error', (err) => { job.log.push(`error: ${err.message}`); job.status = 'failed'; onFinish(); });
      child.on('close', (code) => {
        if (code === 0) run(rest);
        else { job.log.push(`exited with code ${code}`); job.status = 'failed'; onFinish(); }
      });
    };
    run(steps);
    return job;
  };

  return {
    start,
    startSteps,
    get: (id: string) => jobs.get(id),
    latest: (): Job | undefined => [...jobs.values()].at(-1),
    latestFor: (teamId: string): Job | undefined => [...jobs.values()].filter((j) => j.teamId === teamId).at(-1),
  };
};
export type Jobs = ReturnType<typeof createJobs>;
