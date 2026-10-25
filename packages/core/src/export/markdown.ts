import type { Generation } from '@pkmn/data';
import { BossPlanSchema, type BossPlan, type StarterChoice } from '../ingame/bosses.js';
import type { Member, MoveLearn, Team } from '../types.js';

const speciesName = (gen: Generation, id: string): string => gen.species.get(id)?.name ?? id;
const moveName = (gen: Generation, id: string): string => gen.moves.get(id)?.name ?? id;
export const stageLabel = (stage: number): string =>
  stage >= 9 ? 'after the Elite Four' : stage === 0 ? 'no badges needed' : `${stage} badge${stage === 1 ? '' : 's'}`;

/** "Level 41 (Gyarados)", "TM26 (Silph Co. 10F)", "known when caught". */
export const describeMoveSource = (gen: Generation, m: MoveLearn): string => {
  const s = m.source;
  switch (s.kind) {
    case 'start': return `known when caught`;
    case 'level': return `level ${s.level} (${speciesName(gen, s.from)})`;
    case 'tm': return `TM${String(s.number).padStart(2, '0')}, ${s.location}`;
    case 'hm': return `HM${String(s.number).padStart(2, '0')}, ${s.location}`;
  }
};

const pct = (n: number): string => `${n}%`;

const memberSection = (gen: Generation, m: Member): string => {
  const a = m.acquisition!;
  const sp = gen.species.get(m.set.species)!;
  const lines = [
    `### ${speciesName(gen, m.set.species)} (${(sp.types as string[]).join('/')})`,
    '',
    `Roles: ${m.roles.length ? m.roles.join(', ') : 'none in particular'}`,
    '',
    '**Where and when**',
    ...a.steps.map((s) => {
      const levels = s.minLevel !== undefined ? ` (level ${s.minLevel}${s.maxLevel && s.maxLevel !== s.minLevel ? `-${s.maxLevel}` : ''})` : '';
      return `1. ${speciesName(gen, s.species)}: ${s.where}${levels}, with ${stageLabel(s.stage)}`;
    }),
    '',
    `**Moves at level ${m.set.level}**`,
    ...a.moves.map((x) => `- ${moveName(gen, x.move)}: ${describeMoveSource(gen, x)}`),
    ...(a.notes.length ? ['', ...a.notes.map((n) => `> ${n}`)] : []),
  ];
  return lines.join('\n');
};

const bossSection = (gen: Generation, plan: BossPlan): string => {
  const lines = [
    `### ${plan.name}: ${plan.location}`,
    '',
    `With ${stageLabel(plan.stage)}, assuming level ${plan.level}.` +
      (plan.rivalStarter ? ` The rival has ${speciesName(gen, plan.rivalStarter)}'s line.` : ''),
    '',
  ];
  if (plan.notYet.length) lines.push(`Not usable yet: ${plan.notYet.map((id) => speciesName(gen, id)).join(', ')}.`, '');
  if (plan.usable.length === 0) return [...lines, 'Nobody on the team is usable yet.'].join('\n');
  lines.push(
    `Lead with ${plan.lead ? speciesName(gen, plan.lead) : 'your best matchup'}.`,
    '',
    '| Their Pokémon | Best answer | Damage | Their best hit on it |',
    '| --- | --- | --- | --- |',
  );
  for (const m of plan.matchups) {
    const their = `${speciesName(gen, m.bossMon.species)} L${m.bossMon.level}`;
    const answer = m.answer
      ? `${speciesName(gen, m.answer.form)}, ${moveName(gen, m.answer.move)}${m.answer.outspeeds ? ' (outspeeds)' : ''}`
      : 'none';
    const damage = m.answer ? `${pct(m.answer.minPercent)} to ${pct(m.answer.maxPercent)}, ${m.answer.ko}` : '-';
    const threat = m.threat ? `${moveName(gen, m.threat.move)}: ${pct(m.threat.minPercent)} to ${pct(m.threat.maxPercent)}` : '-';
    lines.push(`| ${their} | ${answer} | ${damage} | ${threat} |`);
  }
  if (plan.warnings.length) lines.push('', ...plan.warnings.map((w) => `- Warning: ${w}`));
  return lines.join('\n');
};

/** TMs, HMs, stones and coins the plan needs, deduplicated and ordered by when you can get them. */
const checklist = (gen: Generation, team: Team): string => {
  const tms = new Map<string, { stage: number; users: string[]; where: string }>();
  const other: Array<{ stage: number; text: string }> = [];
  for (const m of team.members) {
    const name = speciesName(gen, m.set.species);
    for (const x of m.acquisition!.moves) {
      if (x.source.kind !== 'tm' && x.source.kind !== 'hm') continue;
      const label = `${x.source.kind.toUpperCase()}${String(x.source.number).padStart(2, '0')} ${moveName(gen, x.move)}`;
      const cur = tms.get(label) ?? { stage: x.stage, users: [], where: x.source.location };
      cur.users.push(name);
      tms.set(label, cur);
    }
    for (const s of m.acquisition!.steps) {
      if (s.how === 'evolution' && /stone/i.test(s.where)) other.push({ stage: s.stage, text: `${s.where} for ${name}` });
      if (s.how === 'prize' || s.how === 'purchase') other.push({ stage: s.stage, text: `${s.where} for ${name}` });
    }
  }
  const lines = [
    ...[...tms].sort((a, b) => a[1].stage - b[1].stage || a[0].localeCompare(b[0])).map(
      ([label, v]) => `- [ ] ${label}: ${v.where} (${stageLabel(v.stage)}), for ${v.users.join(', ')}`,
    ),
    ...other.sort((a, b) => a.stage - b.stage).map((o) => `- [ ] ${o.text} (${stageLabel(o.stage)})`),
  ];
  return lines.length ? lines.join('\n') : 'Nothing special: every move comes from level-ups.';
};

/** The write-up for an in-game team: overview, per-member plan, boss-by-boss strategy, checklist. */
export const teamToMarkdown = (gen: Generation, team: Team, gameName: string): string => {
  const starter = team.analysis['starter'] as StarterChoice | undefined;
  const plans = ((team.analysis['bosses'] as unknown[]) ?? []).map((p) => BossPlanSchema.parse(p));
  const shared = (team.analysis['sharedWeaknesses'] as string[]) ?? [];

  const overview = [
    '| Pokémon | Types | Roles | First catch |',
    '| --- | --- | --- | --- |',
    ...team.members.map((m) => {
      const first = m.acquisition!.steps[0]!;
      return `| ${speciesName(gen, m.set.species)} | ${(gen.species.get(m.set.species)!.types as string[]).join('/')} | ${m.roles.join(', ') || '-'} | ${first.where}, ${stageLabel(first.stage)} |`;
    }),
  ].join('\n');

  return [
    `# ${gameName} team ${team.id}`,
    '',
    `Seed ${team.seed}. Planned for level ${team.analysis['plannedLevel']}.`,
    starter
      ? `Take ${speciesName(gen, starter.player)} as your starter${starter.onTeam ? '' : ' (a helper for the early game; it is not on the final team)'}. Your rival will take ${speciesName(gen, starter.rival)}.`
      : '',
    '',
    '## Team overview',
    '',
    overview,
    '',
    shared.length ? `Shared weaknesses (three or more members): ${shared.join(', ')}.` : 'No type is a weakness for three or more members.',
    '',
    '## Where to get each Pokémon, and what to teach it',
    '',
    team.members.map((m) => memberSection(gen, m)).join('\n\n'),
    '',
    '## Boss-by-boss strategy',
    '',
    'Damage ranges are `@smogon/calc` results with trainer DVs and no stat exp on their side, and average DVs with no stat exp on yours (a floor: real stat exp only helps).',
    '',
    plans.map((p) => bossSection(gen, p)).join('\n\n'),
    '',
    '## Items and TMs checklist',
    '',
    checklist(gen, team),
    '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
};
