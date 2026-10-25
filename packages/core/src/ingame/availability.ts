import type { Generation } from '@pkmn/data';
import type { EncountersFile } from '../data/schemas.js';
import { toID } from '../data/ids.js';
import type { ProgressionFile } from '../games/progression-schema.js';

export type SourceKind = 'wild' | 'surf' | 'rod' | 'gift' | 'static' | 'trade' | 'prize' | 'fossil' | 'purchase';

export type DirectSource = {
  kind: SourceKind;
  /** PokeAPI encounter method, e.g. "walk", "super-rod", "npc-trade". */
  method: string;
  area: string;
  /** Unset for NPC trades: the level follows the Pokémon you give. */
  minLevel?: number;
  maxLevel?: number;
  /** Summed encounter chance across slots in this area, as PokeAPI reports it. */
  chance?: number;
  /** Species you must hand over (NPC trade). */
  give?: string;
  coins?: number;
  /** Yen, for purchases. */
  price?: number;
  /** Where the shop is, for purchases. */
  shop?: string;
  item?: string;
};

export type EvolutionSource = {
  kind: 'evolution';
  from: string;
  how: 'level' | 'stone' | 'trade';
  level?: number;
  item?: string;
};

export type Source = DirectSource | EvolutionSource;

export type Obtainable = {
  species: string;
  /** Earliest stage (0-8 badges, 9 = post Elite Four) this species can be had. */
  stage: number;
  best: Source;
  /** Every route to this species, earliest first. */
  all: Array<Source & { stage: number }>;
};

export type AvailabilityOptions = {
  /** Excludes NPC trades and trade evolutions. */
  noTrades?: boolean;
  noLegendaries?: boolean;
};

const KIND_RANK: Record<Source['kind'], number> = {
  wild: 0,
  surf: 1,
  rod: 2,
  gift: 3,
  static: 4,
  purchase: 5,
  prize: 6,
  fossil: 7,
  trade: 8,
  evolution: 9,
};

const kindOf = (method: string, conditions: string[]): SourceKind => {
  if (method === 'walk') return 'wild';
  if (method === 'surf') return 'surf';
  if (method.endsWith('-rod')) return 'rod';
  if (method === 'static' || method === 'pokeflute') return 'static';
  if (method === 'npc-trade') return 'trade';
  if (method === 'gift') {
    if (conditions.some((c) => c.startsWith('coins-'))) return 'prize';
    if (conditions.some((c) => c.startsWith('item-'))) return 'fossil';
    return 'gift';
  }
  throw new Error(`Unhandled encounter method "${method}"`);
};

/** Collapse per-slot encounter rows into one source per (species, area, method). */
const directSources = (files: EncountersFile[], version: string, progression: ProgressionFile): Map<string, DirectSource[]> => {
  const { purchases, removedSources } = progression.corrections;
  const out = new Map<string, DirectSource[]>();
  for (const file of files) {
    const id = toID(file.species);
    const merged = new Map<string, DirectSource>();
    for (const area of file.areas) {
      if (area.version !== version) continue;
      if (removedSources.some((r) => r.species === id && r.area === area.area)) continue;
      for (const d of area.details) {
        const key = `${area.area}|${d.method}|${d.conditions.join(',')}`;
        const purchase = d.method === 'gift' ? purchases.find((p) => p.species === id && p.area === area.area) : undefined;
        const kind = purchase ? 'purchase' : kindOf(d.method, d.conditions);
        const cur = merged.get(key);
        if (cur) {
          if (cur.minLevel !== undefined) cur.minLevel = Math.min(cur.minLevel, d.minLevel);
          if (cur.maxLevel !== undefined) cur.maxLevel = Math.max(cur.maxLevel, d.maxLevel);
          if (cur.chance !== undefined) cur.chance += d.chance;
          continue;
        }
        const give = d.conditions.find((c) => c.startsWith('trade-'));
        const coins = d.conditions.find((c) => c.startsWith('coins-'));
        const item = d.conditions.find((c) => c.startsWith('item-'));
        merged.set(key, {
          kind,
          method: d.method,
          area: area.area,
          ...(kind === 'trade'
            ? {}
            : { minLevel: d.minLevel, maxLevel: d.maxLevel, chance: d.chance }),
          ...(purchase ? { price: purchase.price, shop: purchase.where } : {}),
          ...(give ? { give: toID(give.slice('trade-'.length)) } : {}),
          ...(coins ? { coins: Number(coins.slice('coins-'.length)) } : {}),
          ...(item ? { item: item.slice('item-'.length) } : {}),
        });
      }
    }
    if (merged.size) out.set(id, [...merged.values()]);
  }
  return out;
};

const areaStage = (progression: ProgressionFile, area: string): number => {
  const entry = progression.areas[area];
  if (!entry) throw new Error(`Area "${area}" has no stage in the progression file; curate it.`);
  return entry.stage;
};

/**
 * Earliest stage each species can be obtained, for one game version.
 * Solved by relaxation because routes depend on each other (evolutions need the pre-evolution,
 * NPC trades need the Pokémon you hand over).
 */
export const buildAvailability = (
  gen: Generation,
  encounters: EncountersFile[],
  version: string,
  progression: ProgressionFile,
  options: AvailabilityOptions = {},
): Map<string, Obtainable> => {
  const direct = directSources(encounters, version, progression);
  const result = new Map<string, Obtainable>();
  const stageOf = (id: string): number | undefined => result.get(id)?.stage;

  const routesFor = (id: string): Array<Source & { stage: number }> => {
    const species = gen.species.get(id);
    if (!species) return [];
    const routes: Array<Source & { stage: number }> = [];
    const legendary = species.tags.some((t) => /Legendary|Mythical/.test(t));

    if (!(options.noLegendaries && legendary)) {
      for (const src of direct.get(id) ?? []) {
        if (src.kind === 'trade' && options.noTrades) continue;
        let stage = Math.max(areaStage(progression, src.area), progression.methods[src.method] ?? 0);
        if (src.give) {
          const giveStage = stageOf(src.give);
          if (giveStage === undefined) continue;
          stage = Math.max(stage, giveStage);
        }
        routes.push({ ...src, stage });
      }
    }

    // Evolution data only means something when the species has a pre-evolution in this gen.
    // (Later-gen fields such as Pikachu's friendship evolution leak through otherwise.)
    if (species.prevo) {
      const from = toID(species.prevo);
      const fromStage = stageOf(from);
      if (fromStage !== undefined) {
        if (species.evoType === 'useItem' && species.evoItem) {
          const item = progression.items[toID(species.evoItem)];
          if (!item) throw new Error(`Evolution item "${species.evoItem}" has no entry in progression items`);
          routes.push({
            kind: 'evolution', from, how: 'stone', item: toID(species.evoItem),
            stage: Math.max(fromStage, item.stage),
          });
        } else if (species.evoType === 'trade') {
          if (!options.noTrades) routes.push({ kind: 'evolution', from, how: 'trade', stage: fromStage });
        } else if (species.evoLevel && !species.evoType) {
          routes.push({ kind: 'evolution', from, how: 'level', level: species.evoLevel, stage: fromStage });
        }
      }
    }

    return routes.sort((a, b) => a.stage - b.stage || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  };

  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (const species of gen.species) {
      const id = toID(species.name);
      const all = routesFor(id);
      const best = all[0];
      if (!best) continue;
      const prev = result.get(id);
      if (!prev || JSON.stringify(prev.all) !== JSON.stringify(all)) {
        result.set(id, { species: id, stage: best.stage, best, all });
        changed = true;
      }
    }
    if (!changed) return result;
  }
  throw new Error('Availability did not converge; the encounter data has a dependency cycle.');
};

export const obtainableBy = (availability: Map<string, Obtainable>, stage: number): Obtainable[] =>
  [...availability.values()].filter((o) => o.stage <= stage);
