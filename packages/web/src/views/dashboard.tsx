import type { FC } from 'hono/jsx';
import type { DataStatus, TeamSummary } from '../store.js';
import { BuildForm, DEFAULT_FORM } from './build.js';
import { Sprite } from './components.js';
import { Layout } from './layout.js';

export const TeamRow: FC<{ team: TeamSummary }> = ({ team }) => (
  <li class="team-row">
    <a href={`/teams/${team.id}`}>
      <strong>{team.id}</strong> <span class="muted">{team.target}</span>
    </a>
    <span class="sprites">{team.species.map((s) => <Sprite species={s} size={1} />)}</span>
  </li>
);

export const DashboardPage: FC<{ games: string[]; teams: TeamSummary[]; status: DataStatus }> = ({ games, teams, status }) => {
  const ready = status.synced.every((s) => s.ok) && status.curated.every((c) => c.ok);
  return (
    <Layout title="Dashboard" active="/">
      <h1>Dashboard</h1>
      {!ready && (
        <div class="notice warn">
          Some data is missing, so teams can't be built yet. <a href="/data">Open the Data page</a> and run a sync.
        </div>
      )}
      <div class="grid two">
        <section>
          <h2>Quick build</h2>
          <BuildForm games={games} values={DEFAULT_FORM} compact />
          <p class="muted"><a href="/build">More options</a>: must include, bans, nuzlocke.</p>
        </section>
        <section>
          <h2>Recent teams</h2>
          {teams.length === 0 ? (
            <p class="muted">No teams yet. Build one on the left.</p>
          ) : (
            <ul class="team-list">{teams.slice(0, 6).map((t) => <TeamRow team={t} />)}</ul>
          )}
          {teams.length > 6 && <p><a href="/teams">All {teams.length} teams</a></p>}
        </section>
      </div>
      <section>
        <h2>Data</h2>
        <ul class="status">
          {status.synced.map((s) => <li class={s.ok ? 'ok' : 'bad'}>{s.label}: {s.count}</li>)}
          {status.curated.map((c) => <li class={c.ok ? 'ok' : 'bad'}>Curated {c.label}</li>)}
        </ul>
      </section>
    </Layout>
  );
};
