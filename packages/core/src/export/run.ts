import { z } from 'zod';
import type { Generation } from '@pkmn/data';
import { loadSpeciesInfo } from '../data/loaders.js';
import type { Boss } from '../games/bosses-schema.js';
import type { PlannerData } from '../ingame/data.js';
import { FactSchema, buildFacts, type Fact } from '../script/facts.js';
import { writeScript, type PickLine } from '../script/templates.js';
import { IdSchema, type Team } from '../types.js';

/** Effects the video knows how to draw, keyed by the type of the move a pick is about. */
export const EFFECT_FOR_TYPE: Record<string, string> = {
  Electric: 'lightning', Fire: 'flames', Water: 'bubbles', Grass: 'leaves', Ice: 'snow', Psychic: 'psychic',
};

const IntroSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('gymLeader'),
    name: z.string(),
    /** "Boulder Badge", "Elite Four", "Rival", "Rocket boss". */
    title: z.string(),
    types: z.array(z.string()),
    sprite: z.string().optional(),
  }),
  z.object({ kind: z.literal('tm'), move: IdSchema, moveName: z.string(), number: z.number().int(), moveType: z.string(), location: z.string() }),
  z.object({ kind: z.literal('pokedex'), genus: z.string().optional(), heightM: z.number().optional(), weightKg: z.number().optional() }),
]);
export type Intro = z.infer<typeof IntroSchema>;

export const LineSchema = z.object({
  text: z.string(),
  factIds: z.array(z.string()),
  /** Who wrote it; a hand-edited line is marked so a regenerate doesn't silently overwrite it. */
  source: z.enum(['template', 'llm', 'edited']).default('template'),
});
export type Line = z.infer<typeof LineSchema>;

export const RunPickSchema = z.object({
  pokemon: IdSchema,
  name: z.string(),
  types: z.array(z.string()),
  dex: z.number().int(),
  /** Badges typically held when you get it; picks are revealed in this order. */
  stage: z.number().int(),
  intro: IntroSchema,
  line: LineSchema,
  effect: z.string().nullable(),
});
export type RunPick = z.infer<typeof RunPickSchema>;

export const RunSchema = z.object({
  id: z.string(),
  title: z.string(),
  teamId: z.string(),
  game: z.string(),
  region: z.string(),
  seed: z.number().int(),
  music: z.string().nullable(),
  voiceover: z.object({ hook: z.string(), outro: z.string() }),
  picks: z.array(RunPickSchema).min(1).max(6),
  /** Every fact a line may cite, so `factIds` can always be checked and audited. */
  facts: z.array(FactSchema),
});
export type Run = z.infer<typeof RunSchema>;

const dominantTypes = (gen: Generation, boss: Boss): string[] => {
  const counts = new Map<string, number>();
  for (const m of boss.variants[0]!.team) {
    for (const t of gen.species.get(m.species)!.types as string[]) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([t]) => t.toLowerCase());
};

const bossTitle = (boss: Boss): string =>
  boss.kind === 'gymLeader' ? `${boss.badge} Badge`
  : boss.kind === 'eliteFour' ? 'Elite Four'
  : boss.kind === 'rival' ? 'Rival'
  : 'Team Rocket';

const introFor = async (data: PlannerData, species: string, line: PickLine, facts: Fact[], dex: number): Promise<Intro> => {
  const { gen } = data;
  if (line.featured.kind === 'boss') {
    const boss = data.bosses.bosses.find((b) => b.id === (line.featured as { bossId: string }).bossId)!;
    return { kind: 'gymLeader', name: boss.name, title: bossTitle(boss), types: dominantTypes(gen, boss) };
  }
  if (line.featured.kind === 'move' && (line.featured.how === 'tm' || line.featured.how === 'hm')) {
    const featuredMove = line.featured.move;
    const tm = facts.find((f): f is Extract<Fact, { kind: 'move' }> => f.kind === 'move' && f.move === featuredMove && f.number !== undefined);
    if (tm) {
      const mv = gen.moves.get(tm.move)!;
      return { kind: 'tm', move: tm.move, moveName: mv.name, number: tm.number!, moveType: (mv.type as string).toLowerCase(), location: tm.location ?? '' };
    }
  }
  const info = await loadSpeciesInfo(dex);
  return { kind: 'pokedex', genus: info?.genus, heightM: info ? info.height / 10 : undefined, weightKg: info ? info.weight / 10 : undefined };
};

const effectFor = (gen: Generation, line: PickLine, facts: Fact[]): string | null => {
  const move =
    line.featured.kind === 'boss'
      ? facts.find((f) => f.kind === 'calc' && f.bossId === (line.featured as { bossId: string }).bossId)
      : line.featured.kind === 'move'
        ? facts.find((f) => f.kind === 'move' && f.move === (line.featured as { move: string }).move)
        : undefined;
  const id = move && 'move' in move ? move.move : undefined;
  const type = id ? (gen.moves.get(id)?.type as string | undefined) : undefined;
  return (type && EFFECT_FOR_TYPE[type]) ?? null;
};

/** Team → run JSON: facts, script, and intro cards, with picks revealed in the order you'd get them. */
export const buildRun = async (data: PlannerData, team: Team, opts: { seed?: number } = {}): Promise<Run> => {
  const { gen, game } = data;
  const seed = opts.seed ?? team.seed ?? 1;
  const factsBySpecies = buildFacts(data, team);
  const favorite = team.theme?.kind === 'favorite' ? team.theme.species : undefined;
  // The favorite is revealed first; everything else in the order you would get it.
  const ordered = team.members
    .map((m, i) => ({ m, i }))
    .sort((a, b) =>
      Number(b.m.set.species === favorite) - Number(a.m.set.species === favorite)
      || a.m.acquisition!.steps[0]!.stage - b.m.acquisition!.steps[0]!.stage || a.i - b.i)
    .map(({ m }) => m);

  const script = writeScript({
    gen, game, seed, favorite,
    picks: ordered.map((m) => ({ species: m.set.species, facts: factsBySpecies.get(m.set.species)! })),
  });

  const picks: RunPick[] = [];
  for (const [i, m] of ordered.entries()) {
    const sp = gen.species.get(m.set.species)!;
    const facts = factsBySpecies.get(m.set.species)!;
    const line = script.picks[i]!;
    picks.push({
      pokemon: m.set.species,
      name: sp.name,
      types: (sp.types as string[]).map((t) => t.toLowerCase()),
      dex: sp.num,
      stage: m.acquisition!.steps[0]!.stage,
      intro: await introFor(data, m.set.species, line, facts, sp.num),
      line: { text: line.text, factIds: line.factIds, source: 'template' },
      effect: effectFor(gen, line, facts),
    });
  }

  return RunSchema.parse({
    id: team.id,
    title: favorite ? `A team for ${gen.species.get(favorite)?.name ?? favorite} fans` : `Building a ${game.region} team`,
    teamId: team.id,
    game: game.id,
    region: game.region,
    seed,
    music: null,
    voiceover: { hook: script.hook, outro: script.outro },
    picks,
    facts: [...factsBySpecies.values()].flat(),
  });
};
