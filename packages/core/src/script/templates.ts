import type { Generation } from '@pkmn/data';
import type { GameConfig } from '../games/config.js';
import { makeRng } from '../rng.js';
import { FACT_PRIORITY, bossFactScore, roundPercent, type Fact } from './facts.js';

export type PickInput = { species: string; facts: Fact[] };
export type PickLine = {
  species: string;
  text: string;
  factIds: string[];
  /** What the line is about, so the intro card can match it. */
  featured: { kind: 'boss'; bossId: string } | { kind: 'move'; move: string; how: 'tm' | 'hm' | 'level' | 'start' } | { kind: 'none' };
};
export type Script = { hook: string; outro: string; picks: PickLine[] };

/** Words per line the template writer aims for; the hard limits live in lint. */
export const TARGET_WORDS = { min: 22, max: 25 };

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

type Kind<K extends Fact['kind']> = Extract<Fact, { kind: K }>;
const ofKind = <K extends Fact['kind']>(facts: Fact[], kind: K): Array<Kind<K>> => facts.filter((f): f is Kind<K> => f.kind === kind);

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

const availPhrase = (f: Kind<'availability'>): string => {
  switch (f.how) {
    case 'wild': return `in ${f.where}`;
    case 'surf': return `by surfing in ${f.where}`;
    case 'rod': return `by fishing in ${f.where}`;
    case 'gift': return `as a gift in ${f.where}`;
    case 'static': return `at ${f.where}`;
    case 'purchase': return `for ${f.price} yen at the ${f.where}`;
    case 'prize': return `at the Game Corner for ${f.coins} coins`;
    case 'fossil': return `by reviving a fossil in ${f.where}`;
    case 'trade': return `from an in-game trade in ${f.where}`;
    default: return `in ${f.where}`;
  }
};

const evolvePhrase = (e: NonNullable<Kind<'availability'>['evolution']>): string =>
  e.how === 'level' ? `at level ${e.level}` : e.how === 'stone' ? `with a ${e.item}` : 'by trading it';

const moveWhen = (f: Kind<'move'>): string =>
  f.how === 'level' ? `at level ${f.level}` : f.how === 'start' ? 'right from the start' : `from ${f.how.toUpperCase()}${f.number}`;

const ROLE_LINES: Record<string, string> = {
  sleep: 'It can put opponents to sleep, which wins fights on its own.',
  paralysis: 'It spreads paralysis, so slower enemies can barely move.',
  recovery: 'It can heal itself, so it keeps coming back into the fight.',
};

type Rng = () => number;
const choose = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

export const HOOKS = (region: string): string[] => [
  `Six Pokémon, one run. Can this ${region} team beat the Elite Four?`,
  `Can this ${region} team really beat the Elite Four and your rival?`,
  `Only six Pokémon. Can this ${region} team really beat the Elite Four?`,
];
/** "If your favorite Pokémon is X" videos. The hook has to fit the 12-word limit even with a long name. */
export const FAVORITE_HOOKS = (name: string, region: string, mono?: string): string[] =>
  (mono
    ? [`Your favorite is ${name}? Here is a ${mono}-only team.`, `If your favorite is ${name}, here is its ${mono}-only team.`]
    : [
        `Your favorite is ${name}? Here is a ${region} team built around it.`,
        `If your favorite is ${name}, here is a team built around it.`,
        `${name} is your favorite? Then build your whole team around it.`,
        `Your favorite is ${name}? Here is its team.`,
      ]
  ).filter((h) => wordCount(h) <= 12);

/** Mono-type videos: every member shares one type. */
export const MONO_HOOKS = (type: string, region: string): string[] => [
  `Only ${type} types. Can this ${region} team beat the Elite Four?`,
  `Can a ${type}-only ${region} team really beat the Elite Four?`,
  `Six ${type} Pokémon, no exceptions. Can they beat the Elite Four?`,
];
export const MONO_OUTROS: string[] = [
  `Which type should I try next? Tell me in the comments.`,
  `Would you run this team? Name the next type below.`,
];
export const FAVORITE_OUTROS: string[] = [
  `Who is your favorite? Comment it and get a team.`,
  `Comment your favorite Pokémon and I will build its team.`,
  `Would you swap anyone? Tell me your favorite below.`,
];
/** Said before the favorite's own line; it has no name, because the line itself names the Pokémon a few words in. */
const FAVORITE_LEADS: string[] = ['Your favorite goes first.', 'Built around your favorite.', 'The heart of the team.'];

export const OUTROS: string[] = [
  `That's the team. Would you run it? Drop yours in the comments.`,
  `Which Pokémon would you swap out? Tell me in the comments below.`,
  `Would you run this team? Drop your own in the comments below.`,
];

/**
 * How a move's damage is described. Overkill (a guaranteed knockout) is a knockout, never "200 percent";
 * partial damage is a rounded percentage, with the number of hits when the calc is sure of it.
 */
const damageClauses = (c: { bossMon: string; pct: number; minPercent: number; ko: string }): string[] => {
  if (c.minPercent >= 100) return [`knocks out ${c.bossMon} in one hit`, `wipes out ${c.bossMon} in a single hit`];
  const hits = /^guaranteed (\d+)HKO/.exec(c.ko)?.[1];
  const tail = hits && hits !== '1' ? `, and it takes just ${hits} hits to finish the job` : '';
  return [
    `takes about ${c.pct} percent off ${c.bossMon}${tail}`,
    `hits ${c.bossMon} for about ${c.pct} percent${tail}`,
    `does roughly ${c.pct} percent to ${c.bossMon}${tail}`,
  ];
};

type BossCtx = { name: string; boss: string; move: string; dmg: string };
// The name comes a few words in, after the card's subject, so the card is on screen while the line introduces it
// and the ball opens on the name. It stays in the first half of the line (the lint warns otherwise).
const BOSS_TEMPLATES: Array<(c: BossCtx) => string> = [
  (c) => `Here's how we deal with ${c.boss}: ${c.name}. ${c.move} ${c.dmg}.`,
  (c) => `${c.boss} looks scary, but ${c.name} makes it easy. ${c.move} ${c.dmg}.`,
  (c) => `For ${c.boss}, we need an answer, and ${c.name} is it. ${c.move} ${c.dmg}.`,
  (c) => `Against ${c.boss}, we bring in ${c.name}. ${c.move} ${c.dmg}, and that decides the fight.`,
];

type PlainCtx = { name: string; avail: string; move: string; when: string };
const PLAIN_TEMPLATES: Array<(c: PlainCtx) => string> = [
  (c) => `Next up is ${c.name}. You can get it ${c.avail}, and ${c.move} becomes its main weapon ${c.when}.`,
  (c) => `Here's a pick we can count on: ${c.name}. You can find it ${c.avail}. Then ${c.move} gives it real power ${c.when}.`,
  (c) => `Our next pick is ${c.name}. It's yours ${c.avail}, and once it has ${c.move} ${c.when}, it hits hard.`,
];

/** Shorter lines for when a long acquisition phrase pushes every full template over the word limit. */
const SHORT_TEMPLATES: Array<(c: PlainCtx) => string> = [
  (c) => `Next up is ${c.name}. You can get it ${c.avail}, and ${c.move} comes ${c.when}.`,
  (c) => `Our next pick is ${c.name}, and ${c.move} becomes its main weapon ${c.when}.`,
];

export type WriterInput = { gen: Generation; game: GameConfig; picks: PickInput[]; seed: number; /** Species id of the favorite, for the "if your favorite is X" concept. */ favorite?: string; /** The type every member shares, for mono-type videos. */ mono?: string };

/**
 * The template writer: no API key, deterministic for a seed. For each pick it takes the strongest facts
 * (boss matchup > calc > key move > availability), fills a template, and adds tail sentences while the
 * line stays within the word target.
 */
export const writeScript = ({ gen, game, picks, seed, favorite, mono }: WriterInput): Script => {
  const rng = makeRng(seed);

  // Keep the intro cards varied: at most all but two picks are about a boss (gold cards); the rest
  // feature a TM or the Pokémon itself (green and red cards). The strongest boss stories keep their slot.
  const bestBossScore = picks.map((p) => {
    const calcs = ofKind(p.facts, 'calc');
    return Math.max(-1, ...calcs.map((c) => bossFactScore(c.bossKind as never, c.maxPercent)));
  });
  const maxBossPicks = picks.length >= 4 ? picks.length - 2 : picks.length;
  const bossPicks = new Set(
    bestBossScore.map((score, i) => ({ score, i })).filter((x) => x.score >= 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, maxBossPicks).map((x) => x.i),
  );
  let plainSoFar = 0;
  const usedBosses = new Set<string>();
  const usedMoves = new Set<string>();
  let previousTail = '';
  const lines: PickLine[] = [];

  for (const [pickIndex, pick] of picks.entries()) {
    const name = gen.species.get(pick.species)?.name ?? pick.species;
    const matchups = ofKind(pick.facts, 'matchup');
    const calcs = ofKind(pick.facts, 'calc');
    const moves = ofKind(pick.facts, 'move').sort((a, b) => b.weight - a.weight || a.move.localeCompare(b.move));
    const avail = ofKind(pick.facts, 'availability')[0]!;
    const roles = ofKind(pick.facts, 'role');

    // Best unused boss we have both a matchup and a calc for.
    const bossPairs = matchups
      .map((m) => ({ m, c: calcs.find((c) => c.bossId === m.bossId) }))
      .filter((p): p is { m: Kind<'matchup'>; c: Kind<'calc'> } => !!p.c && !usedBosses.has(p.m.bossId) && bossPicks.has(pickIndex))
      .sort((a, b) => bossFactScore(b.m.bossKind as never, b.c.maxPercent) - bossFactScore(a.m.bossKind as never, a.c.maxPercent) || a.m.id.localeCompare(b.m.id));

    type Tail = { text: string; id: string };
    const tails: Tail[] = [];
    const moveFact = (exclude?: string) => moves.find((m) => m.move !== exclude && m.weight > 0);
    const availTail = (): Tail => {
      const e = avail.evolution;
      const first = gen.species.get(avail.firstSpecies)?.name ?? avail.firstSpecies;
      return e && avail.firstSpecies !== pick.species
        ? { text: `Catch ${first} ${availPhrase(avail)}, then evolve it ${evolvePhrase(e)}.`, id: avail.id }
        : { text: `You can get it ${availPhrase(avail)}.`, id: avail.id };
    };

    type Candidate = { text: string; factIds: string[] };
    const candidates: Candidate[] = [];
    let featured: PickLine['featured'] = { kind: 'none' };
    const top = bossPairs[0];
    if (top) {
      usedBosses.add(top.m.bossId);
      const bossMon = gen.species.get(top.m.bossMon)?.name ?? top.m.bossMon;
      const move = gen.moves.get(top.c.move)?.name ?? top.c.move;
      const clauses = damageClauses({
        bossMon, pct: Math.min(95, roundPercent((top.c.minPercent + top.c.maxPercent) / 2)),
        minPercent: top.c.minPercent, ko: top.c.ko,
      });
      featured = { kind: 'boss', bossId: top.m.bossId };
      const m = moveFact(top.c.move);
      if (m) tails.push({ text: `${gen.moves.get(m.move)?.name ?? m.move} comes ${moveWhen(m)}.`, id: m.id });
      tails.push(availTail());
      for (const r of roles) if (ROLE_LINES[r.role]) tails.push({ text: ROLE_LINES[r.role]!, id: r.id });
      for (const t of BOSS_TEMPLATES) {
        for (const dmg of clauses) {
          const base = t({ name, boss: top.m.boss, move, dmg });
          candidates.push({ text: base, factIds: [top.m.id, top.c.id] });
          for (const [i, a] of tails.entries()) {
            candidates.push({ text: `${base} ${a.text}`, factIds: [top.m.id, top.c.id, a.id] });
            for (const b of tails.slice(i + 1)) candidates.push({ text: `${base} ${a.text} ${b.text}`, factIds: [top.m.id, top.c.id, a.id, b.id] });
          }
        }
      }
    } else {
      // Alternate which kind of move headlines: a TM (green card) first, then a level-up move (Pokédex card).
      const preferTm = plainSoFar % 2 === 0;
      plainSoFar++;
      const usable = moves.filter((x) => x.weight > 0);
      const matching = usable.filter((x) => (x.how === 'tm' || x.how === 'hm') === preferTm);
      const m = matching[0] ?? usable[0];
      const move = m ? (gen.moves.get(m.move)?.name ?? m.move) : undefined;
      for (const r of roles) if (ROLE_LINES[r.role]) tails.push({ text: ROLE_LINES[r.role]!, id: r.id });
      if (m && move) {
        featured = { kind: 'move', move: m.move, how: m.how };
        const plain = { name, avail: availPhrase(avail), move, when: moveWhen(m) };
        for (const t of [...PLAIN_TEMPLATES, ...SHORT_TEMPLATES]) {
          const base = t(plain);
          candidates.push({ text: base, factIds: [avail.id, m.id] });
          for (const a of tails) candidates.push({ text: `${base} ${a.text}`, factIds: [avail.id, m.id, a.id] });
        }
      } else {
        const base = `Next up is ${name}. You can get it ${availPhrase(avail)}, and it is ready for what comes.`;
        candidates.push({ text: base, factIds: [avail.id] });
      }
    }

    // The favorite's line starts with a short lead, so its body gets that many fewer words.
    const lead = pick.species === favorite ? choose(rng, FAVORITE_LEADS) : '';
    const reserve = lead ? wordCount(lead) : 0;
    const limit = { min: TARGET_WORDS.min - reserve, max: TARGET_WORDS.max - reserve };

    // Keep lines inside the word window; of those, pick one with the seeded RNG so scripts vary.
    const inWindow = candidates.filter((c) => wordCount(c.text) >= limit.min && wordCount(c.text) <= limit.max);
    const fits = candidates.filter((c) => wordCount(c.text) <= limit.max);
    // Never empty: if nothing fits the limit, fall back to the shortest line (lint will flag it).
    const longest = fits.length ? Math.max(...fits.map((c) => wordCount(c.text))) : 0;
    const shortest = Math.min(...candidates.map((c) => wordCount(c.text)));
    const pool = inWindow.length
      ? inWindow
      : fits.length ? fits.filter((c) => wordCount(c.text) === longest) : candidates.filter((c) => wordCount(c.text) === shortest);

    // Across the video, prefer lines that don't repeat a move already named and don't end the same way.
    const factById = new Map(pick.facts.map((f) => [f.id, f]));
    const movesOf = (c: Candidate): string[] =>
      c.factIds.flatMap((id) => {
        const f = factById.get(id);
        return f && (f.kind === 'move' || f.kind === 'calc') ? [f.move] : [];
      });
    const tailOf = (c: Candidate): string => factById.get(c.factIds[c.factIds.length - 1]!)?.kind ?? '';
    const repeats = (c: Candidate) => movesOf(c).filter((m) => usedMoves.has(m)).length * 2 + (tailOf(c) === previousTail ? 1 : 0);
    const least = Math.min(...pool.map(repeats));
    const { text, factIds } = choose(rng, pool.filter((c) => repeats(c) === least));
    for (const c of [{ text, factIds }]) for (const m of movesOf(c)) usedMoves.add(m);
    previousTail = tailOf({ text, factIds });
    lines.push({ species: pick.species, text: lead ? `${lead} ${cap(text)}` : cap(text), factIds, featured });
  }

  const favoriteName = favorite ? gen.species.get(favorite)?.name : undefined;
  const hook = choose(rng, favoriteName ? FAVORITE_HOOKS(favoriteName, game.region, mono) : mono ? MONO_HOOKS(mono, game.region) : HOOKS(game.region));
  const outro = choose(rng, favoriteName ? FAVORITE_OUTROS : mono ? MONO_OUTROS : OUTROS);
  return { hook, outro, picks: lines };
};

export { FACT_PRIORITY };
