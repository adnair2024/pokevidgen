import {
  getGame, loadDictionary, loadPlannerData, loadPronunciationWords, repoDir, type LintContext, type PlannerData,
} from '@pokevidgen/core';
import { createJobs, type Jobs } from './jobs.js';
import { createPublishService, type PublishService } from './publish-service.js';
import { createVoiceService, type VoiceService } from './voice-service.js';
import { createRunStore, createStore, type RunStore, type Store } from './store.js';

export type Deps = {
  store: Store;
  runs: RunStore;
  jobs: Jobs;
  /** Speech: status, manifests, auditions. Replaceable in tests. */
  voice: VoiceService;
  /** TikTok inbox upload. Replaceable in tests. */
  publish: PublishService;
  /** Where renders are written (`out/`). */
  outDir: string;
  /** Planner data for a game, loaded once and reused (it is a few MB of JSON). */
  data: (gameId: string) => Promise<PlannerData>;
  /** Everything `lintRun` needs for a game (the dictionary and respellings are loaded once). */
  lintContext: (gameId: string) => Promise<LintContext>;
};

export const createDeps = (opts: { teamsDir?: string; runsDir?: string; outDir?: string; jobs?: Jobs; voice?: VoiceService; publish?: PublishService } = {}): Deps => {
  const cache = new Map<string, Promise<PlannerData>>();
  const data = (gameId: string): Promise<PlannerData> => {
    let p = cache.get(gameId);
    if (!p) {
      p = loadPlannerData(getGame(gameId));
      // A failed load (e.g. data not synced yet) must not be cached, so syncing then retrying works.
      p.catch(() => cache.delete(gameId));
      cache.set(gameId, p);
    }
    return p;
  };

  let words: Promise<{ dictionary: Set<string>; pronunciations: Set<string> }> | undefined;
  const lintContext = async (gameId: string): Promise<LintContext> => {
    words ??= Promise.all([loadDictionary(), loadPronunciationWords()]).then(([dictionary, pronunciations]) => ({ dictionary, pronunciations }));
    const [{ dictionary, pronunciations }, d] = await Promise.all([words, data(gameId)]);
    return { gen: d.gen, dictionary, pronunciations };
  };

  return {
    store: createStore(opts.teamsDir ?? repoDir('teams')),
    runs: createRunStore(opts.runsDir ?? repoDir('runs')),
    jobs: opts.jobs ?? createJobs(() => { cache.clear(); words = undefined; }),
    voice: opts.voice ?? createVoiceService(),
    publish: opts.publish ?? createPublishService(),
    outDir: opts.outDir ?? repoDir('out'),
    data,
    lintContext,
  };
};
