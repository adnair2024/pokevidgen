import type { Generation } from '@pkmn/data';
import type { Run } from '../export/run.js';

export const LIMITS = {
  hookWords: 12,
  outroWords: 12,
  pickMinWords: 12,
  pickMaxWords: 25,
  /** Narration speed the duration estimate assumes, in words per second at speed 1.0. */
  wordsPerSecond: 2.7,
  totalSeconds: { min: 55, max: 80 },
} as const;

export type LintIssue = { level: 'error' | 'warning'; where: string; message: string };
export type LintResult = {
  ok: boolean;
  issues: LintIssue[];
  stats: { words: number; estimatedSeconds: number; perLine: Array<{ where: string; words: number }> };
};

export type LintContext = {
  gen: Generation;
  /** Lowercase words that have a respelling for the speech engine. */
  pronunciations: ReadonlySet<string>;
  /** Lowercase English words. */
  dictionary: ReadonlySet<string>;
  /** Voice speed; faster narration shortens the estimate. Defaults to 1.0, as the spec measures. */
  speed?: number;
};

export const wordsOf = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

/** Lowercase, accents and punctuation stripped, so "Pokémon" and "pokemon!" compare equal. */
export const normalize = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Words the speech engine will read. Codes that mix letters and digits (B1F, TM15, HM3) are skipped:
 * they aren't words to respell, and the voice step expands them.
 */
const tokens = (text: string): string[] =>
  [...text.normalize('NFD').replace(/\p{M}/gu, '').replace(/\b[A-Za-z]*\d+[A-Za-z]*\b/g, ' ').matchAll(/[A-Za-z][A-Za-z'.]*/g)].map((m) => m[0].toLowerCase().replace(/\.$/, ''));

const knownWord = (w: string, ctx: LintContext): boolean => {
  if (w.length === 1 && (w === 'a' || w === 'i')) return true;
  if (ctx.pronunciations.has(w) || ctx.pronunciations.has(w + '.') || ctx.dictionary.has(w)) return true;
  // Contractions and possessives: check the stem ("that's" → "that", "rival's" → "rival").
  const stem = w.split("'")[0]!;
  return stem !== w && (ctx.dictionary.has(stem) || ctx.pronunciations.has(stem));
};

export const lintRun = (run: Run, ctx: LintContext): LintResult => {
  const issues: LintIssue[] = [];
  const add = (level: LintIssue['level'], where: string, message: string) => issues.push({ level, where, message });
  const perLine: LintResult['stats']['perLine'] = [];
  const factsById = new Map(run.facts.map((f) => [f.id, f]));

  const hookWords = wordsOf(run.voiceover.hook).length;
  const outroWords = wordsOf(run.voiceover.outro).length;
  perLine.push({ where: 'hook', words: hookWords }, { where: 'outro', words: outroWords });
  if (hookWords > LIMITS.hookWords) add('error', 'hook', `Hook is ${hookWords} words; the limit is ${LIMITS.hookWords}.`);
  if (outroWords > LIMITS.outroWords) add('error', 'outro', `Outro is ${outroWords} words; the limit is ${LIMITS.outroWords}.`);

  for (const pick of run.picks) {
    const where = `pick ${pick.name}`;
    const words = wordsOf(pick.line.text).length;
    perLine.push({ where, words });
    if (words > LIMITS.pickMaxWords) add('error', where, `Line is ${words} words; the limit is ${LIMITS.pickMaxWords}.`);
    else if (words < LIMITS.pickMinWords) add('warning', where, `Line is only ${words} words; aim for at least ${LIMITS.pickMinWords}.`);

    const normalizedLine = normalize(pick.line.text);
    const normalizedName = normalize(pick.name);
    const at = normalizedLine.indexOf(normalizedName);
    if (at < 0) add('error', where, `The line never says "${pick.name}".`);
    else if (at > normalizedLine.length / 2) add('warning', where, `"${pick.name}" comes late in the line; the reveal lands on the name, so say it in the first half.`);

    if (pick.line.factIds.length === 0) add('error', where, 'The line cites no facts.');
    for (const id of pick.line.factIds) {
      const fact = factsById.get(id);
      if (!fact) add('error', where, `The line cites "${id}", which is not a fact in this run.`);
      else if (fact.species !== pick.pokemon) add('warning', where, `Fact "${id}" is about ${fact.species}, not ${pick.pokemon}.`);
    }
    if (pick.line.source === 'llm') issues.push(...claimsCheck(pick.line.text, pick.line.factIds, where, factsById, ctx));
  }

  const words = perLine.reduce((s, l) => s + l.words, 0);
  const estimatedSeconds = words / LIMITS.wordsPerSecond / (ctx.speed ?? 1);
  if (estimatedSeconds < LIMITS.totalSeconds.min || estimatedSeconds > LIMITS.totalSeconds.max) {
    add('error', 'total', `Estimated narration is ${estimatedSeconds.toFixed(0)}s (${words} words); it must be ${LIMITS.totalSeconds.min}-${LIMITS.totalSeconds.max}s.`);
  }

  // Words the speech engine may mispronounce: not English and no respelling yet.
  const seen = new Set<string>();
  const allText = [run.voiceover.hook, ...run.picks.map((p) => p.line.text), run.voiceover.outro];
  for (const text of allText) {
    for (const w of tokens(text)) {
      if (seen.has(w) || knownWord(w, ctx)) continue;
      seen.add(w);
      add('warning', 'pronunciation', `No pronunciation for "${w}"; add a respelling in data/curated/pronunciations.json.`);
    }
  }

  return { ok: !issues.some((i) => i.level === 'error'), issues, stats: { words, estimatedSeconds, perLine } };
};

/**
 * For model-written lines: every Pokémon, move and number named must appear in a cited fact.
 * (Template lines are built from fact fields, so they cannot violate this.)
 */
export const claimsCheck = (
  text: string,
  factIds: string[],
  where: string,
  factsById: ReadonlyMap<string, Run['facts'][number]>,
  ctx: LintContext,
): LintIssue[] => {
  const issues: LintIssue[] = [];
  const cited = factIds.map((id) => factsById.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
  const allowed = {
    pokemon: new Set(cited.flatMap((f) => f.mentions.pokemon)),
    moves: new Set(cited.flatMap((f) => f.mentions.moves)),
    numbers: new Set(cited.flatMap((f) => f.mentions.numbers)),
  };
  const norm = normalize(text);
  for (const sp of ctx.gen.species) {
    if (sp.num < 1 || sp.num > 151 || allowed.pokemon.has(sp.id)) continue;
    if (norm.includes(normalize(sp.name)) && (normalize(sp.name).length > 3)) {
      issues.push({ level: 'error', where, message: `Names ${sp.name}, which no cited fact mentions.` });
    }
  }
  for (const mv of ctx.gen.moves) {
    if (!mv.exists || allowed.moves.has(mv.id)) continue;
    // Moves named like ordinary words ("Surf", "Rest", "Strength") would false-positive; only multi-word or non-dictionary names are checked.
    if (ctx.dictionary.has(mv.name.toLowerCase())) continue;
    if (norm.includes(normalize(mv.name))) issues.push({ level: 'error', where, message: `Names the move ${mv.name}, which no cited fact mentions.` });
  }
  for (const m of text.matchAll(/\d+/g)) {
    if (!allowed.numbers.has(Number(m[0]))) issues.push({ level: 'error', where, message: `Says ${m[0]}, which no cited fact contains.` });
  }
  return issues;
};
