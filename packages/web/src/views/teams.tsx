import type { FC } from 'hono/jsx';
import type { TeamSummary } from '../store.js';
import { Sprite } from './components.js';
import { Layout } from './layout.js';

export const TeamsPage: FC<{ teams: TeamSummary[] }> = ({ teams }) => (
  <Layout title="Teams" active="/teams">
    <h1>Teams</h1>
    {teams.length === 0 ? (
      <p class="muted">Nothing saved yet. <a href="/build">Build a team.</a></p>
    ) : (
      <table class="table">
        <thead><tr><th>Team</th><th>Game</th><th>Seed</th><th>Members</th><th>Saved</th><th></th></tr></thead>
        <tbody>
          {teams.map((t) => (
            <tr>
              <td><a href={`/teams/${t.id}`}>{t.id}</a></td>
              <td>{t.target}</td>
              <td>{t.seed ?? ''}</td>
              <td class="sprites">{t.species.map((s) => <Sprite species={s} size={1} />)}</td>
              <td class="muted">{t.modified.toISOString().slice(0, 16).replace('T', ' ')}</td>
              <td>
                <button class="danger" hx-post={`/teams/${t.id}/delete`} hx-confirm={`Delete ${t.id}?`} hx-target="closest tr" hx-swap="outerHTML">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Layout>
);
