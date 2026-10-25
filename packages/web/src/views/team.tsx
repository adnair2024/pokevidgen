import type { Generation } from '@pokevidgen/core';
import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import {
  BossPlanSchema, bestEffectiveness, describeMoveSource, effectiveness, offensiveCoverage, teamDefense, typeNames,
  type BossPlan, type LintResult, type Member, type Run, type StarterChoice, type Team,
} from '@pokevidgen/core';
import { Sprite, TypeChip, stageLabel } from './components.js';
import { Layout } from './layout.js';
import type { Job } from '../jobs.js';
import type { RenderOutput } from '../store.js';
import { VideoPanel, type PublishView } from './video.js';
import type { VoiceView } from './voice.js';

export const TABS = [
  ['overview', 'Team'],
  ['defense', 'Types'],
  ['bosses', 'Bosses'],
  ['writeup', 'Write-up'],
  ['video', 'Video'],
] as const;
export type Tab = (typeof TABS)[number][0];
export const isTab = (s: string): s is Tab => TABS.some(([t]) => t === s);

const nameOf = (gen: Generation, id: string) => gen.species.get(id)?.name ?? id;
const moveNameOf = (gen: Generation, id: string) => gen.moves.get(id)?.name ?? id;
const typesOf = (gen: Generation, id: string) => gen.species.get(id)!.types as string[];

const MemberCard: FC<{ gen: Generation; member: Member }> = ({ gen, member }) => {
  const a = member.acquisition!;
  return (
    <article class="card member">
      <header>
        <Sprite species={member.set.species} />
        <div>
          <h3>{nameOf(gen, member.set.species)}</h3>
          <div>{typesOf(gen, member.set.species).map((t) => <TypeChip type={t} />)}</div>
          <div class="muted">Level {member.set.level} · {member.roles.join(', ') || 'no special role'}</div>
        </div>
      </header>
      <h4>Where and when</h4>
      <ol class="steps">
        {a.steps.map((s) => (
          <li>
            <strong>{nameOf(gen, s.species)}</strong>: {s.where}
            {s.minLevel !== undefined && <span class="muted"> · level {s.minLevel}{s.maxLevel && s.maxLevel !== s.minLevel ? `-${s.maxLevel}` : ''}</span>}
            <span class="chip">{stageLabel(s.stage)}</span>
          </li>
        ))}
      </ol>
      {a.notes.length > 0 && a.notes.map((n) => <div class="notice warn note">{n}</div>)}
      <h4>Moves</h4>
      <table class="table compact">
        <tbody>
          {a.moves.map((m) => {
            const mv = gen.moves.get(m.move);
            return (
              <tr>
                <td>{mv ? <TypeChip type={mv.type} /> : null}</td>
                <td><strong>{moveNameOf(gen, m.move)}</strong></td>
                <td class="muted">{describeMoveSource(gen, m)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
};

const OverviewTab: FC<{ gen: Generation; team: Team }> = ({ gen, team }) => {
  const starter = team.analysis['starter'] as StarterChoice | undefined;
  const shared = (team.analysis['sharedWeaknesses'] as string[]) ?? [];
  return (
    <>
      {starter && (
        <div class="notice info">
          Take <strong>{nameOf(gen, starter.player)}</strong> as your starter
          {starter.onTeam ? '' : ' (an early-game helper; it is not on the final team)'}. Your rival will take{' '}
          <strong>{nameOf(gen, starter.rival)}</strong>.
        </div>
      )}
      {shared.length > 0 && <div class="notice warn">Three or more members are weak to: {shared.join(', ')}.</div>}
      <div class="grid members">{team.members.map((m) => <MemberCard gen={gen} member={m} />)}</div>
    </>
  );
};

const MULT_LABEL: Record<string, string> = { '0': '0', '0.25': '¼', '0.5': '½', '1': '', '2': '2', '4': '4' };

const DefenseTab: FC<{ gen: Generation; team: Team }> = ({ gen, team }) => {
  const types = typeNames(gen);
  const members = team.members.map((m) => ({ id: m.set.species, types: typesOf(gen, m.set.species) }));
  const defense = teamDefense(gen, members.map((m) => m.types));
  const attackTypes = [...new Set(team.members.flatMap((m) => m.set.moves
    .map((id) => gen.moves.get(id)).filter((mv) => mv && mv.basePower > 1).map((mv) => mv!.type as string)))];
  const coverage = offensiveCoverage(gen, attackTypes);
  const hits = (defender: string) => bestEffectiveness(gen, attackTypes, [defender]);
  const synergy = team.analysis['synergy'] as { holes: string[]; uncovered: string[]; duplicatePrimary: number; normalMembers: number; distinctTypes: number } | undefined;
  return (
    <>
      {synergy && (
        <div class={`notice ${synergy.holes.length ? 'warn' : 'info'}`}>
          {synergy.holes.length === 0
            ? 'No defensive holes: nothing is a weakness for two members without something on the team resisting it.'
            : `Defensive hole: two or more members are weak to ${synergy.holes.join(', ')} and nothing resists it (a required Pokémon may have forced this).`}{' '}
          The team has {synergy.distinctTypes} different types and its moves hit {types.length - synergy.uncovered.length} of {types.length} types super effectively.
        </div>
      )}
      <h2>Defence</h2>
      <p class="muted">Damage taken from each attacking type. Red cells are weaknesses; green are resistances or immunities.</p>
      <div class="scroll">
        <table class="matrix">
          <thead>
            <tr><th></th>{types.map((t) => <th><TypeChip type={t} /></th>)}</tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr>
                <th class="rowhead"><Sprite species={m.id} size={1} /> {nameOf(gen, m.id)}</th>
                {types.map((t) => {
                  const mult = effectiveness(gen, t, m.types);
                  const cls = mult > 1 ? 'weak' : mult === 0 ? 'immune' : mult < 1 ? 'resist' : '';
                  return <td class={cls}>{MULT_LABEL[String(mult)] ?? mult}</td>;
                })}
              </tr>
            ))}
            <tr class="total">
              <th class="rowhead">Weak / resist</th>
              {types.map((t) => {
                const d = defense[t]!;
                return <td class={d.weak >= 3 ? 'weak' : ''}>{d.weak}/{d.resist + d.immune}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <h2>Offence</h2>
      <p class="muted">Types hit super effectively by at least one damaging move on the team.</p>
      <div class="chips">
        {types.map((t) => <span class={`cov ${hits(t) > 1 ? 'yes' : 'no'}`}><TypeChip type={t} /></span>)}
      </div>
      {coverage.gaps.length > 0 && <p>Not covered: {coverage.gaps.map((t) => <TypeChip type={t} />)}</p>}
    </>
  );
};

const BossBlock: FC<{ gen: Generation; plan: BossPlan }> = ({ gen, plan }) => (
  <details class={`boss ${plan.warnings.length ? 'has-warnings' : ''}`}>
    <summary>
      <strong>{plan.name}</strong> <span class="muted">{plan.location}</span>
      <span class="chip">{stageLabel(plan.stage)}</span>
      <span class="chip">L{plan.level}</span>
      {plan.warnings.length > 0 && <span class="chip warn">{plan.warnings.length} warning{plan.warnings.length === 1 ? '' : 's'}</span>}
    </summary>
    {plan.rivalStarter && <p class="muted">Rival starter line: {nameOf(gen, plan.rivalStarter)}.</p>}
    {plan.notYet.length > 0 && <p class="muted">Not usable yet: {plan.notYet.map((id) => nameOf(gen, id)).join(', ')}.</p>}
    {plan.usable.length === 0 ? (
      <p>Nobody on the team is usable yet.</p>
    ) : (
      <>
        <p>Lead with <strong>{plan.lead ? nameOf(gen, plan.lead) : 'your best matchup'}</strong>.</p>
        <table class="table compact">
          <thead><tr><th>Their Pokémon</th><th>Best answer</th><th>Damage</th><th>Their best hit on it</th></tr></thead>
          <tbody>
            {plan.matchups.map((m) => (
              <tr>
                <td><Sprite species={m.bossMon.species} size={1} /> {nameOf(gen, m.bossMon.species)} <span class="muted">L{m.bossMon.level}</span></td>
                <td>{m.answer ? <>{nameOf(gen, m.answer.form)}: {moveNameOf(gen, m.answer.move)}{m.answer.outspeeds ? <span class="chip">outspeeds</span> : null}</> : 'none'}</td>
                <td class="calc" title={m.answer?.description}>{m.answer ? <>{m.answer.minPercent}–{m.answer.maxPercent}%<br /><small>{m.answer.ko}</small></> : '-'}</td>
                <td class={m.threat && m.threat.maxPercent >= 100 ? 'weak calc' : 'calc'} title={m.threat?.description}>
                  {m.threat ? <>{moveNameOf(gen, m.threat.move)}: {m.threat.minPercent}–{m.threat.maxPercent}%</> : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {plan.warnings.length > 0 && <ul class="warnings">{plan.warnings.map((w) => <li>{w}</li>)}</ul>}
      </>
    )}
  </details>
);

const BossesTab: FC<{ gen: Generation; team: Team }> = ({ gen, team }) => {
  const plans = ((team.analysis['bosses'] as unknown[]) ?? []).map((p) => BossPlanSchema.parse(p));
  return (
    <>
      <p class="muted">
        In story order. Damage uses <code>@smogon/calc</code>: trainer DVs and no stat exp on their side, average DVs and no stat exp on
        yours (a floor). Hover a damage cell for the full calc line.
      </p>
      {plans.map((p) => <BossBlock gen={gen} plan={p} />)}
    </>
  );
};

const WriteupTab: FC<{ team: Team; html: string }> = ({ team, html }) => (
  <>
    <p><a class="button" href={`/teams/${team.id}/download.md`}>Download .md</a> <a class="button" href={`/teams/${team.id}/team.json`}>Team JSON</a></p>
    <article class="prose">{raw(html)}</article>
  </>
);

export const TeamPage: FC<{ gen: Generation; team: Team; gameName: string; tab: Tab; writeupHtml: string; run?: Run; lint?: LintResult; outputs?: RenderOutput[]; job?: Job; voice?: VoiceView; publish?: PublishView }> = ({ gen, team, gameName, tab, writeupHtml, run, lint, outputs, job, voice, publish }) => (
  <Layout title={team.id} active="/teams">
    <div class="titlebar">
      <div>
        <h1>{team.id}</h1>
        <p class="muted">{gameName} · seed {team.seed} · planned for level {String(team.analysis['plannedLevel'])}</p>
      </div>
      <div class="actions">
        <form method="post" action="/build" class="inline">
          <input type="hidden" name="game" value={team.target} />
          <input type="hidden" name="seed" value={String((team.seed ?? 0) + 1)} />
          <button type="submit">Next seed</button>
        </form>
        <button class="danger" hx-post={`/teams/${team.id}/delete`} hx-vals='{"redirect":"1"}' hx-confirm={`Delete ${team.id}?`}>Delete</button>
      </div>
    </div>
    <nav class="tabs">
      {TABS.map(([t, label]) => <a href={`/teams/${team.id}?tab=${t}`} class={t === tab ? 'active' : ''}>{label}</a>)}
    </nav>
    {tab === 'overview' && <OverviewTab gen={gen} team={team} />}
    {tab === 'defense' && <DefenseTab gen={gen} team={team} />}
    {tab === 'bosses' && <BossesTab gen={gen} team={team} />}
    {tab === 'writeup' && <WriteupTab team={team} html={writeupHtml} />}
    {tab === 'video' && <VideoPanel team={team} run={run} lint={lint} outputs={outputs} job={job} voice={voice} publish={publish} />}
  </Layout>
);
