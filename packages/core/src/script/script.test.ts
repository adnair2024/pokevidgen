import { beforeAll, describe, expect, it } from 'vitest';
import { cacheDir, exists } from '../data/cache.js';
import { RunSchema, buildRun, type Run } from '../export/run.js';
import { getGame } from '../games/index.js';
import { loadPlannerData, type PlannerData } from '../ingame/data.js';
import { planIngameTeam } from '../ingame/planner.js';
import type { Team } from '../types.js';
import { loadDictionary, loadPronunciationWords } from './dictionary.js';
import { buildFacts, FactSchema } from './facts.js';
import { LIMITS, lintRun, normalize, type LintContext } from './lint.js';
import { HOOKS, OUTROS, TARGET_WORDS, wordCount } from './templates.js';

const hasCache = await exists(cacheDir('pokeapi', 'encounters'));

/** A run with one field changed, for checking that lint catches it. */
const tweak = (run: Run, change: (r: Run) => void): Run => {
  const copy = structuredClone(run);
  change(copy);
  return copy;
};

describe.skipIf(!hasCache)('script, facts and lint (needs `pnpm data:sync`)', () => {
  let red: PlannerData;
  let blue: PlannerData;
  let team: Team;
  let run: Run;
  let ctx: LintContext;

  beforeAll(async () => {
    red = await loadPlannerData(getGame('red'));
    blue = await loadPlannerData(getGame('blue'));
    team = await planIngameTeam(red, { seed: 3 });
    run = await buildRun(red, team);
    ctx = { gen: red.gen, dictionary: await loadDictionary(), pronunciations: await loadPronunciationWords() };
  });

  describe('facts', () => {
    it('are valid, uniquely identified, and about the pick they belong to', () => {
      const facts = buildFacts(red, team);
      const ids = new Set<string>();
      for (const [species, list] of facts) {
        for (const f of list) {
          expect(() => FactSchema.parse(f)).not.toThrow();
          expect(f.species).toBe(species);
          expect(f.id.startsWith(`${species}.`)).toBe(true);
          expect(ids.has(f.id), f.id).toBe(false);
          ids.add(f.id);
        }
        expect(list.some((f) => f.kind === 'availability')).toBe(true);
      }
    });

    it('only claim boss matchups for the final form, with numbers that match the calcs', () => {
      const plans = team.analysis['bosses'] as Array<{ boss: string; matchups: Array<{ bossMon: { species: string }; answer?: { member: string; form: string; maxPercent: number; minPercent: number } }> }>;
      for (const [species, list] of buildFacts(red, team)) {
        for (const f of list) {
          if (f.kind !== 'calc') continue;
          const plan = plans.find((p) => p.boss === f.bossId)!;
          const m = plan.matchups.find((x) => x.bossMon.species === f.bossMon)!;
          expect(m.answer!.member).toBe(species);
          expect(m.answer!.form).toBe(species);
          expect(f.maxPercent).toBe(m.answer!.maxPercent);
          expect(f.mentions.numbers).toContain(f.minPercent);
        }
      }
    });
  });

  describe('the template writer', () => {
    it('is deterministic for a seed and varies between seeds', async () => {
      const again = await buildRun(red, team);
      expect(again).toEqual(run);
      const other = await buildRun(red, team, { seed: 99 });
      expect(other.picks.map((p) => p.line.text)).not.toEqual(run.picks.map((p) => p.line.text));
    });

    it('writes lines that fit the word window, with a hook and outro inside their limits', async () => {
      for (const data of [red, blue]) {
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
          const r = await buildRun(data, await planIngameTeam(data, { seed }));
          expect(HOOKS(data.game.region)).toContain(r.voiceover.hook);
          expect(OUTROS).toContain(r.voiceover.outro);
          for (const p of r.picks) {
            const n = wordCount(p.line.text);
            expect(n, p.line.text).toBeGreaterThanOrEqual(TARGET_WORDS.min);
            expect(n, p.line.text).toBeLessThanOrEqual(TARGET_WORDS.max);
            expect(p.line.text, 'overkill must read as a knockout').not.toMatch(/\b(1\d\d|[2-9]\d\d) percent/);
          }
        }
      }
    });

    it('only cites facts that exist, are about the pick, and say the Pokémon\'s name', () => {
      const byId = new Map(run.facts.map((f) => [f.id, f]));
      for (const p of run.picks) {
        expect(p.line.factIds.length).toBeGreaterThan(0);
        for (const id of p.line.factIds) expect(byId.get(id)?.species, id).toBe(p.pokemon);
        expect(normalize(p.line.text)).toContain(normalize(p.name));
      }
    });

    it('never says a number that is not in a cited fact', () => {
      const byId = new Map(run.facts.map((f) => [f.id, f]));
      for (const p of run.picks) {
        const allowed = new Set(p.line.factIds.flatMap((id) => byId.get(id)!.mentions.numbers));
        for (const m of p.line.text.matchAll(/\d+/g)) expect(allowed.has(Number(m[0])), `${m[0]} in "${p.line.text}"`).toBe(true);
      }
    });
  });

  describe('the run', () => {
    it('is valid, reveals picks in the order you would get them, and names real bosses on gym cards', () => {
      expect(() => RunSchema.parse(run)).not.toThrow();
      const stages = run.picks.map((p) => p.stage);
      expect(stages).toEqual([...stages].sort((a, b) => a - b));
      const bossNames = new Set(red.bosses.bosses.map((b) => b.name));
      for (const p of run.picks) {
        if (p.intro.kind === 'gymLeader') expect(bossNames.has(p.intro.name)).toBe(true);
        if (p.intro.kind === 'tm') expect(red.tms.tms.some((t) => t.number === (p.intro as { number: number }).number)).toBe(true);
      }
    });

    it('varies the intro cards: at most four gym cards, and a TM or Pokédex card for the rest', async () => {
      const kinds = new Set<string>();
      for (const data of [red, blue]) {
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
          const r = await buildRun(data, await planIngameTeam(data, { seed }));
          const gym = r.picks.filter((p) => p.intro.kind === 'gymLeader').length;
          expect(gym, `${data.game.id} seed ${seed}`).toBeLessThanOrEqual(Math.max(4, r.picks.length - 2));
          for (const p of r.picks) kinds.add(p.intro.kind);
        }
      }
      expect([...kinds].sort()).toEqual(['gymLeader', 'pokedex', 'tm']);
    });

    it('uses only effects the video draws, keyed to the move type', () => {
      for (const p of run.picks) expect([null, 'lightning', 'flames', 'bubbles', 'leaves', 'snow', 'psychic']).toContain(p.effect);
    });
  });

  describe('lint', () => {
    it('passes every generated script for both games (no errors)', async () => {
      for (const data of [red, blue]) {
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
          const r = await buildRun(data, await planIngameTeam(data, { seed }));
          const result = lintRun(r, { ...ctx, gen: data.gen });
          expect(result.issues.filter((i) => i.level === 'error'), `${data.game.id} seed ${seed}`).toEqual([]);
          expect(result.stats.estimatedSeconds).toBeGreaterThanOrEqual(LIMITS.totalSeconds.min);
          expect(result.stats.estimatedSeconds).toBeLessThanOrEqual(LIMITS.totalSeconds.max);
        }
      }
    });

    const errors = (r: Run) => lintRun(r, ctx).issues.filter((i) => i.level === 'error').map((i) => i.message);

    it('fails a line over the word limit, and a hook or outro over theirs', () => {
      const long = tweak(run, (r) => { r.picks[0]!.line.text += ' and then some more words that keep going and going on and on'; });
      expect(errors(long).join()).toMatch(/limit is 25/);
      const hook = tweak(run, (r) => { r.voiceover.hook = 'one two three four five six seven eight nine ten eleven twelve thirteen'; });
      expect(errors(hook).join()).toMatch(/Hook is 13 words/);
      const outro = tweak(run, (r) => { r.voiceover.outro = 'one two three four five six seven eight nine ten eleven twelve thirteen'; });
      expect(errors(outro).join()).toMatch(/Outro is 13 words/);
    });

    it('fails a total outside 55-80 seconds', () => {
      const short = tweak(run, (r) => { for (const p of r.picks) p.line.text = `${p.name} is great and wins.`; });
      expect(errors(short).join()).toMatch(/must be 55-80s/);
    });

    it('fails a pick line that never says the Pokémon\'s name', () => {
      const nameless = tweak(run, (r) => { r.picks[1]!.line.text = 'This one is a very strong pick for the early part of the game, honestly.'; });
      expect(errors(nameless).join()).toContain(`never says "${run.picks[1]!.name}"`);
    });

    it('fails a line with no facts, or with a fact id that does not exist', () => {
      expect(errors(tweak(run, (r) => { r.picks[0]!.line.factIds = []; })).join()).toMatch(/cites no facts/);
      expect(errors(tweak(run, (r) => { r.picks[0]!.line.factIds = ['nope.fact']; })).join()).toMatch(/"nope.fact", which is not a fact/);
    });

    it('warns (without failing) about a word with no respelling and no dictionary entry', () => {
      const odd = tweak(run, (r) => { r.picks[0]!.line.text = `${r.picks[0]!.line.text.replace(/\.$/, '')} Zzyzxqwerty.`; });
      const issues = lintRun(odd, ctx).issues;
      expect(issues.some((i) => i.level === 'warning' && /zzyzxqwerty/.test(i.message))).toBe(true);
      expect(lintRun(odd, ctx).issues.filter((i) => i.level === 'error' && /zzyzx/i.test(i.message))).toEqual([]);
    });

    it('does not flag codes like B1F, TM15 or HM3 as words needing a respelling', () => {
      const coded = tweak(run, (r) => { r.picks[0]!.line.text = `${r.picks[0]!.name} lives in Rock Tunnel B1F and learns Dig from TM28 or Surf from HM3 today, which is plenty.`; });
      const words = lintRun(coded, ctx).issues.filter((i) => i.where === 'pronunciation').map((i) => i.message);
      expect(words.join()).not.toMatch(/"(b|f|tm|hm)"/);
    });

    it('rejects a model-written line that names a Pokémon, move or number its facts do not contain', () => {
      const pick = run.picks[0]!;
      const llm = (text: string) => tweak(run, (r) => { r.picks[0] = { ...pick, line: { text, factIds: pick.line.factIds, source: 'llm' } }; });
      const other = red.gen.species.get(pick.pokemon === 'mewtwo' ? 'snorlax' : 'mewtwo')!.name;
      expect(errors(llm(`${pick.name} beats ${other} easily.`)).join()).toMatch(/Names Mewtwo|Names Snorlax/);
      expect(errors(llm(`${pick.name} does 987 damage.`)).join()).toMatch(/Says 987/);
      expect(errors(llm(`${pick.name} spams Twineedle all day.`)).join()).toMatch(/Twineedle/);
      // A clean claim passes (ignoring the total-length rule, which a one-line edit would trip).
      const clean = lintRun(llm(`${pick.name} is on the team.`), ctx).issues.filter((i) => i.level === 'error' && i.where !== 'total');
      expect(clean).toEqual([]);
    });
  });
});
