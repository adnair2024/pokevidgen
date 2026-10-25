import type { Generation } from '@pkmn/data';
import { sharedWeaknesses, stabMatchup, teamDefense } from '../analysis/coverage.js';
import { reachOf, teamSynergy } from '../analysis/synergy.js';
import { rolesOfSet, type Role } from '../analysis/roles.js';
import { toID } from '../data/ids.js';
import type { Boss } from '../games/bosses-schema.js';
import { makeRng } from '../rng.js';
import type { AcquisitionStep, Member, MoveLearn, Team } from '../types.js';
import { buildAvailability, type DirectSource, type Obtainable } from './availability.js';
import type { PlannerData } from './data.js';
import { chainOf, evolutionInto, evolutionsOf } from './families.js';
import { learnableMoves } from './learnsets.js';
import { analyseBosses, chooseStarter, typicalLevelAt } from './bosses.js';
import { selectMoves, utilityRolesOf } from './moves.js';

export type PlannerInput = {
  seed: number;
  /** Species that must be on the team; the planner errors rather than dropping one. */
  must?: string[];
  /** Build the team around this Pokémon ("if your favorite is X"): it is required, and the team is marked with the theme. */
  favorite?: string;
  /** Mono-type: every member has this type (as either of its types). */
  mono?: string;
  ban?: string[];
  noTrades?: boolean;
  noLegendaries?: boolean;
  /** First-encounter rules: no two members may start from the same area. */
  nuzlocke?: boolean;
  /** Sampling temperature; higher explores more. Mainly for tuning. */
  temperature?: number;
  /** The first pick is drawn from this many top candidates (the team's "anchor"); 1 = always the best. */
  anchors?: number;
};

/** All scoring weights in one place. Each term is roughly 0..1 before weighting. */
export const WEIGHTS = {
  timing: 0.2, // earlier availability (line and final form)
  bossGain: 0.4, // new matchup coverage against the game's actual bosses
  stats: 0.12, // base stat total
  movepool: 0.1, // damage types learnable, strong STAB move
  role: 0.08, // fills sleep / paralysis / recovery / speed the team lacks
} as const;

/**
 * Candidates are sampled with probability proportional to exp(score / TEMPERATURE), using the seeded
 * RNG. Tuned on 100 seeds per setting: at 0.03 one Pokémon appeared in 98% of teams; at 0.2 (with a 30-wide
 * anchor) 70 different species appear in 100 teams, the most common in 26%, with the same average strength and no
 * more defensive holes, because the repair pass fixes any that sampling leaves.
 */
export const TEMPERATURE = 0.2;
/** The first pick is drawn from the best this many candidates, so each seed builds around a different core. */
export const ANCHOR_POOL = 30;

const BOSS_WEIGHT: Record<Boss['kind'], number> = { gymLeader: 1, eliteFour: 1, rival: 0.6, villain: 0.5 };

/** The last stage before the Elite Four: what "the whole game minus postgame" means. */
export const END_STAGE = 8;

export class PlannerError extends Error {}

type Candidate = {
  id: string;
  /** The whole evolutionary family, root first. */
  chain: string[];
  /** The route actually taken from first catch to this form. */
  route: string[];
  acquiredLevel: number;
  root: string;
  types: string[];
  stage: number;
  lineStage: number;
  stats: number;
  movepool: number;
  roles: Set<Role>;
  groups: Set<string>;
  /** Defending types this Pokémon's STAB and best coverage moves hit super effectively. */
  reach: Set<string>;
  /** Evolution stones this line consumes, e.g. ['moonstone']. */
  stones: string[];
  /** Fit against each boss, 0..1 (mean over that boss's Pokémon and rival variants). */
  fit: Map<string, number>;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Level the team is planned for: the Elite Four's average level. */
export const plannedLevel = (data: PlannerData): number => {
  const levels = data.bosses.bosses
    .filter((b) => b.kind === 'eliteFour')
    .flatMap((b) => b.variants.flatMap((v) => v.team.map((m) => m.level)));
  return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
};

const bossFit = (gen: Generation, types: readonly string[], boss: Boss): number => {
  const per = boss.variants.map((v) => {
    const scores = v.team.map((m) => {
      const theirs = gen.species.get(m.species)!.types as string[];
      return clamp01((stabMatchup(gen, types, theirs) + 2) / 4);
    });
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  });
  return per.reduce((a, b) => a + b, 0) / per.length;
};

const stoneStage = (data: PlannerData) => (item: string): number => {
  const entry = data.progression.items[item];
  if (!entry) throw new Error(`No stage for evolution item "${item}"`);
  return entry.stage;
};

const prettyArea = (slug: string): string =>
  slug
    .replace(/^kanto-/, '')
    .replace(/-area(-|$)/, '$1')
    .split('-')
    .map((w) =>
      w === 'mt' ? 'Mt.'
      : /^b?\d+f$/.test(w) ? w.toUpperCase()
      : /^\d/.test(w) ? w
      : w[0]!.toUpperCase() + w.slice(1),
    )
    .join(' ')
    .replace(/\bPokemon\b/, 'Pokémon');

/** "moonstone" → "Moon Stone". */
const itemName = (id: string): string => id.replace(/stone$/, ' stone').replace(/^./, (c) => c.toUpperCase()).replace(/ s/, ' S');

const nameOf = (gen: Generation, id: string): string => gen.species.get(id)?.name ?? id;

const describeDirect = (gen: Generation, src: DirectSource): string => {
  const where = prettyArea(src.area);
  switch (src.kind) {
    case 'wild': return `${where} (grass/cave)`;
    case 'surf': return `${where} (surfing)`;
    case 'rod': return `${where} (${src.method.replace('-', ' ')})`;
    case 'gift': return `Gift in ${where}`;
    case 'static': return `Static encounter in ${where}`;
    case 'purchase': return `Buy for ¥${src.price} at the ${src.shop}`;
    case 'prize': return `Celadon Game Corner prize (${src.coins} coins)`;
    case 'fossil': return `Revive at ${where} (${src.item?.replace(/-/g, ' ')})`;
    case 'trade': return `NPC trade in ${where} (give ${nameOf(gen, src.give!)})`;
  }
};

/** Stones consumed along a Pokémon's cheapest route. */
const stonesUsed = (avail: Map<string, Obtainable>, id: string): string[] => {
  const best = avail.get(id)?.best;
  if (!best || best.kind !== 'evolution') return [];
  return [...stonesUsed(avail, best.from), ...(best.how === 'stone' ? [best.item!] : [])];
};

const howOf = (kind: DirectSource['kind']): AcquisitionStep['how'] => kind;

/** From first catch to final form: walks back through `best` routes so shortcuts (prizes, gifts) are used. */
const acquisitionSteps = (data: PlannerData, avail: Map<string, Obtainable>, id: string): AcquisitionStep[] => {
  const o = avail.get(id)!;
  const best = o.best;
  if (best.kind !== 'evolution') {
    return [{
      species: id, how: howOf(best.kind), where: describeDirect(data.gen, best),
      minLevel: best.minLevel, maxLevel: best.maxLevel, stage: o.stage,
      place: best.kind === 'purchase' ? best.shop : prettyArea(best.area),
      price: best.price, coins: best.coins,
    }];
  }
  const where =
    best.how === 'level' ? `Evolves from ${nameOf(data.gen, best.from)} at level ${best.level}`
    : best.how === 'stone' ? `Evolve ${nameOf(data.gen, best.from)} with a ${itemName(best.item!)} (${data.progression.items[best.item!]!.source})`
    : `Trade-evolve ${nameOf(data.gen, best.from)} (needs a link partner)`;
  return [
    ...acquisitionSteps(data, avail, best.from),
    {
      species: id, how: 'evolution', where, stage: o.stage,
      evolution: { how: best.how, level: best.level, item: best.item ? itemName(best.item) : undefined },
    },
  ];
};

/**
 * Level-up moves learned by a pre-evolution that evolves by item or trade: the player has to hold off
 * evolving until that level. Only worth saying when the level is well above where the player usually
 * is when the evolution becomes possible.
 */
const evolutionNotes = (data: PlannerData, gen: Generation, route: string[], steps: AcquisitionStep[], picks: MoveLearn[]): string[] => {
  const notes: string[] = [];
  for (const [i, from] of route.entries()) {
    const next = route[i + 1];
    if (!next) continue;
    const evo = evolutionInto(gen, next);
    if (!evo || evo.how === 'level') continue;
    const evoStage = steps.find((s) => s.species === next)?.stage ?? 0;
    const typical = typicalLevelAt(data, evoStage);
    const late = picks.filter((p) => p.source.kind === 'level' && p.source.from === from && p.source.level > typical);
    if (late.length === 0) continue;
    const until = Math.max(...late.map((p) => (p.source as { level: number }).level));
    const names = late.map((p) => gen.moves.get(p.move)?.name ?? p.move).join(' and ');
    notes.push(`Hold off evolving ${nameOf(gen, from)} until level ${until} to learn ${names}; ${nameOf(gen, next)} can't learn it.`);
  }
  return notes;
};

export const planIngameTeam = async (data: PlannerData, input: PlannerInput): Promise<Team> => {
  const { gen, progression, bosses } = data;
  const rng = makeRng(input.seed);
  const avail = buildAvailability(gen, data.encounters, data.game.pokeApiVersion, progression, {
    noTrades: input.noTrades,
    noLegendaries: input.noLegendaries,
  });
  const level = plannedLevel(data);
  const ban = new Set((input.ban ?? []).map(toID));
  const favorite = input.favorite ? toID(input.favorite) : undefined;
  const must = [...new Set([...(favorite ? [favorite] : []), ...(input.must ?? []).map(toID)])];
  const monoType = input.mono ? gen.types.get(toID(input.mono)) : undefined;
  if (input.mono && !monoType?.exists) throw new PlannerError(`"${input.mono}" is not a gen ${gen.num} type.`);
  const mono = monoType?.name;
  const hasMono = (id: string): boolean => !mono || (gen.species.get(id)!.types as string[]).includes(mono);

  // --- Candidates: obtainable, not post-game, not banned, and final forms (unless the user asked for it).
  const groupsOf = (chain: string[]) =>
    new Set(progression.exclusiveGroups.filter((g) => g.species.some((s) => chain.includes(s))).map((g) => g.id));

  const build = async (id: string): Promise<Candidate> => {
    const chain = chainOf(gen, id);
    const steps = acquisitionSteps(data, avail, id);
    const route = steps.map((st) => st.species);
    const acquiredLevel = steps[0]!.minLevel ?? 1;
    const species = gen.species.get(id)!;
    const types = species.types as string[];
    const learnable = learnableMoves({ gen, tms: data.tms, learnsets: data.learnsets, chain: route, acquiredLevel, level, stage: END_STAGE });
    const damaging = [...learnable.keys()]
      .map((m) => gen.moves.get(m)!)
      .filter((m) => m.exists && m.basePower >= 60);
    const damageTypes = new Set(damaging.map((m) => m.type));
    const bestStab = Math.max(0, ...damaging.filter((m) => types.includes(m.type)).map((m) => m.basePower));
    // Attack types it can really use: STAB types it has a strong move for, plus its two best other types.
    // Normal has no super effective matchups, so it never adds reach.
    const byType = new Map<string, number>();
    for (const m of damaging) byType.set(m.type as string, Math.max(byType.get(m.type as string) ?? 0, m.basePower));
    const stabTypes = types.filter((t) => byType.has(t));
    const coverageTypes = [...byType].filter(([t]) => !types.includes(t) && t !== 'Normal').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
    const reach = reachOf(gen, [...stabTypes, ...coverageTypes]);
    const roles = new Set(utilityRolesOf([...learnable.keys()]));
    const b = species.baseStats;
    return {
      id, chain, route, acquiredLevel, root: chain[0]!, types,
      stage: avail.get(id)!.stage,
      lineStage: Math.min(...chain.map((c) => avail.get(c)?.stage ?? Infinity)),
      stats: clamp01((b.hp + b.atk + b.def + b.spa + b.spe) / 480),
      movepool: clamp01(damageTypes.size / 8) * 0.5 + clamp01(bestStab / 120) * 0.5,
      roles,
      reach,
      groups: groupsOf(chain),
      stones: stonesUsed(avail, id),
      fit: new Map(bosses.bosses.map((boss) => [boss.id, bossFit(gen, types, boss)])),
    };
  };

  for (const id of must) {
    if (!gen.species.get(id)?.exists) throw new PlannerError(`"${id}" is not a gen ${gen.num} species.`);
    if (ban.has(id)) throw new PlannerError(`"${id}" is both required and banned.`);
    const o = avail.get(id);
    if (!o) throw new PlannerError(`${id} is not obtainable in ${data.game.name} with these constraints.`);
    if (o.stage > END_STAGE) throw new PlannerError(`${id} is only available after the Elite Four in ${data.game.name}.`);
    if (!hasMono(id)) throw new PlannerError(`${id} is not ${mono}-type, so it cannot be on a mono-${mono} team.`);
  }
  if (must.length > 6) throw new PlannerError('At most 6 species can be required.');

  const finalIds = [...avail.keys()].filter(
    (id) => avail.get(id)!.stage <= END_STAGE && evolutionsOf(gen, id).every((e) => !avail.has(e)) && hasMono(id),
  );
  const ids = [...new Set([...must, ...finalIds])].filter((id) => !ban.has(id) || must.includes(id));
  const candidates = new Map<string, Candidate>();
  for (const id of ids) candidates.set(id, await build(id));

  // --- Greedy selection with marginal scoring.
  const chosen: Candidate[] = [];
  const conflict = (c: Candidate, team: Candidate[]): string | undefined => {
    for (const [item, entry] of Object.entries(progression.items)) {
      if (entry.quantity === undefined) continue;
      const used = [...team, c].flatMap((m) => m.stones).filter((s) => s === item).length;
      if (used > entry.quantity) return `${c.id} would need a ${itemName(item)} but only ${entry.quantity} exist`;
    }
    for (const t of team) {
      if (t.root === c.root) return `${c.id} and ${t.id} come from the same single ${c.root}`;
      for (const g of c.groups) if (t.groups.has(g)) return `${c.id} and ${t.id} are mutually exclusive (${g})`;
      if (input.nuzlocke && startArea(c) === startArea(t)) return `${c.id} and ${t.id} start in the same area (nuzlocke)`;
    }
    return undefined;
  };
  const startArea = (c: Candidate): string => {
    const first = avail.get(c.root)?.best;
    return first && first.kind !== 'evolution' ? first.area : `evolution-${c.root}`;
  };

  const totalWeight = bosses.bosses.reduce((s, b) => s + BOSS_WEIGHT[b.kind], 0);
  const add = (c: Candidate) => chosen.push(c);

  for (const id of must) {
    const c = candidates.get(id)!;
    const why = conflict(c, chosen);
    if (why) throw new PlannerError(`Cannot build this team: ${why}.`);
    add(c);
  }

  // One objective for the whole team: each member's own merits, how well the team covers the bosses, the roles
  // it fills, and its synergy (defensive holes, offensive reach, variety). Picks add to it greedily; a repair
  // pass below swaps members out when the result still has a hole.
  const synergyOf = (team: Candidate[]) => teamSynergy(gen, team.map((m) => ({ types: m.types, reach: m.reach })), { variety: !mono });
  const timingOf = (c: Candidate) => 0.5 * (1 - c.lineStage / END_STAGE) + 0.5 * (1 - c.stage / END_STAGE);
  const ownMerit = (c: Candidate) => WEIGHTS.timing * timingOf(c) + WEIGHTS.stats * c.stats + WEIGHTS.movepool * c.movepool;
  const bossCoverage = (team: Candidate[]) =>
    (WEIGHTS.bossGain * 4 * bosses.bosses.reduce((sum, b) => sum + BOSS_WEIGHT[b.kind] * Math.max(0, ...team.map((m) => m.fit.get(b.id)!)), 0)) / totalWeight;
  const roleScore = (team: Candidate[]) => (WEIGHTS.role * new Set(team.flatMap((m) => [...m.roles])).size) / 3;
  const objective = (team: Candidate[]) => team.reduce((sum, m) => sum + ownMerit(m), 0) + bossCoverage(team) + roleScore(team) + synergyOf(team).score;

  const score = (c: Candidate): number => objective([...chosen, c]) - objective(chosen);

  while (chosen.length < 6) {
    const pool = [...candidates.values()].filter((c) => !chosen.includes(c) && !conflict(c, chosen));
    if (pool.length === 0) break;
    const ranked = pool.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id));
    const top = ranked[0]!.s;
    // The first free pick is the team's anchor: drawn evenly from the best few, then everything else is built around it.
    const anchorPool = chosen.length === 0 ? (input.anchors ?? ANCHOR_POOL) : 0;
    const weights = anchorPool > 1
      ? ranked.map((_, i) => (i < anchorPool ? 1 : 0))
      : ranked.map((r) => Math.exp((r.s - top) / (input.temperature ?? TEMPERATURE)));
    let roll = rng() * weights.reduce((a, b) => a + b, 0);
    const pickIndex = weights.findIndex((w) => (roll -= w) <= 0);
    add(ranked[pickIndex < 0 ? 0 : pickIndex]!.c);
  }

  // Repair: greedy picks can't foresee that a later member will leave two others weak to a type nothing resists.
  // While the team has a hole (or two members sharing a primary type), make the single swap (never a required member) that raises the objective most.
  // Teams without holes are left alone, which keeps different seeds producing different teams.
  if (chosen.length === 6) {
    const flawed = () => { const r = synergyOf(chosen); return r.holes.length > 0 || (!mono && r.duplicatePrimary > 0); };
    for (let pass = 0; pass < 4 && flawed(); pass++) {
      let best: { index: number; c: Candidate; gain: number } | undefined;
      const base = objective(chosen);
      for (let i = 0; i < chosen.length; i++) {
        if (must.includes(chosen[i]!.id)) continue;
        const others = chosen.filter((_, j) => j !== i);
        for (const c of candidates.values()) {
          if (chosen.includes(c) || conflict(c, others)) continue;
          const gain = objective([...others.slice(0, i), c, ...others.slice(i)]) - base;
          if (gain > (best?.gain ?? 0.02)) best = { index: i, c, gain };
        }
      }
      if (!best) break;
      chosen[best.index] = best.c;
    }
  }
  if (chosen.length === 0) throw new PlannerError('No candidates satisfy these constraints.');
  if (mono && chosen.length < 6) {
    throw new PlannerError(`Only ${chosen.length} ${mono}-type Pokémon from different lines can be combined in ${data.game.name} with these constraints; a mono team needs 6.`);
  }

  // --- Sets: moves from what is actually learnable by the planned level, TMs single-use.
  const tmUses = new Map<number, number>();
  const tmCopies = (n: number): number => {
    const tm = data.tms.tms.find((t) => t.kind === 'tm' && t.number === n);
    if (!tm) return 1;
    return tm.sources.some((s) => s.kind === 'shop' || s.kind === 'prize') ? Infinity : tm.sources.length;
  };
  const teamRoles = new Set<Role>();
  const teamMoves = new Map<string, number>();
  /** Defending types the moves chosen so far hit super effectively, so later members fill the gaps. */
  const teamCovered = new Set<string>();
  const members: Member[] = [];
  for (const c of chosen) {
    const learnable = learnableMoves({ gen, tms: data.tms, learnsets: data.learnsets, chain: c.route, acquiredLevel: c.acquiredLevel, level, stage: END_STAGE });
    const picks: MoveLearn[] = selectMoves({ gen, species: c.id, level, learnable, teamRoles, teamMoves, teamCovered, tmUses, tmCopies });
    const moveIds = picks.map((p) => p.move);
    for (const m of moveIds) teamMoves.set(m, (teamMoves.get(m) ?? 0) + 1);
    for (const t of reachOf(gen, moveIds.map((m) => gen.moves.get(m)!).filter((m) => m.basePower > 1).map((m) => m.type as string))) teamCovered.add(t);
    for (const r of utilityRolesOf(moveIds)) teamRoles.add(r);
    const stage = Math.max(c.stage, ...picks.map((p) => p.stage));
    const steps = acquisitionSteps(data, avail, c.id);
    members.push({
      set: { species: c.id, level, moves: moveIds },
      roles: rolesOfSet(gen, c.id, moveIds),
      acquisition: {
        stage,
        steps,
        moves: picks.map((p) => ({ ...p, source: p.source })),
        notes: evolutionNotes(data, gen, c.route, steps, picks),
      },
    });
  }

  const types = chosen.map((c) => c.types);
  const id = [data.game.id, mono && `mono-${toID(mono)}`, favorite && `fav-${favorite}`, `s${input.seed}`].filter(Boolean).join('-');
  const theme = favorite || mono ? { favorite, mono } : undefined;
  const draft: Team = { id, kind: 'ingame', target: data.game.id, seed: input.seed, theme, members, analysis: {} };
  const starter = chooseStarter(data, draft);
  return {
    id,
    kind: 'ingame',
    target: data.game.id,
    seed: input.seed,
    theme,
    members,
    analysis: {
      plannedLevel: level,
      constraints: { must, mono, ban: [...ban], noTrades: !!input.noTrades, noLegendaries: !!input.noLegendaries, nuzlocke: !!input.nuzlocke },
      sharedWeaknesses: sharedWeaknesses(gen, types, 3),
      // Computed from the moves actually chosen, not each Pokémon's potential, so it describes the real team.
      synergy: (({ holes, severe, uncovered, duplicatePrimary, normalMembers, distinctTypes, score }) => ({ holes, severe, uncovered, duplicatePrimary, normalMembers, distinctTypes, score }))(
        teamSynergy(gen, members.map((m) => ({
          types: gen.species.get(m.set.species)!.types as string[],
          reach: reachOf(gen, m.set.moves.map((id) => gen.moves.get(id)!).filter((mv) => mv.basePower > 1).map((mv) => mv.type as string)),
        })), { variety: !mono }),
      ),
      teamDefense: teamDefense(gen, types),
      starter,
      bosses: await analyseBosses(data, draft, starter),
    },
  };
};

export { evolutionInto, stoneStage };
