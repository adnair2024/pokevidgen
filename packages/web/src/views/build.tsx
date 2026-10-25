import type { FC } from 'hono/jsx';
import { Notice } from './components.js';
import { Layout } from './layout.js';

export type BuildFormValues = {
  game: string;
  seed: string;
  favorite: string;
  must: string;
  ban: string;
  noTrades: boolean;
  noLegendaries: boolean;
  nuzlocke: boolean;
};

export const DEFAULT_FORM: BuildFormValues = { game: 'red', seed: '', favorite: '', must: '', ban: '', noTrades: false, noLegendaries: false, nuzlocke: false };

/** The form is a fragment so htmx can swap it in place when there is an error. */
export const BuildForm: FC<{ games: string[]; values: BuildFormValues; error?: string; compact?: boolean }> = ({ games, values, error, compact }) => (
  <form id="build-form" hx-post="/build" hx-target="#build-form" hx-swap="outerHTML" class="card form">
    {error && <Notice kind="error">{error}</Notice>}
    <div class="row">
      <label>
        Game
        <select name="game">
          {games.map((g) => <option value={g} selected={g === values.game}>{g[0]!.toUpperCase() + g.slice(1)}</option>)}
        </select>
      </label>
      <label>
        Seed <small>(blank = random)</small>
        <input name="seed" inputmode="numeric" pattern="[0-9]*" value={values.seed} placeholder="e.g. 42" />
      </label>
    </div>
    <label>
      Favorite Pokémon <small>(optional: makes an "if your favorite is X" video, with X built into the team and shown first)</small>
      <input name="favorite" value={values.favorite} placeholder="e.g. charizard" />
    </label>
    {!compact && (
      <div class="row">
        <label>
          Must include <small>(comma separated)</small>
          <input name="must" value={values.must} placeholder="pikachu, snorlax" />
        </label>
        <label>
          Never include
          <input name="ban" value={values.ban} placeholder="rattata" />
        </label>
      </div>
    )}
    <div class="row checks">
      <label class="check"><input type="checkbox" name="noTrades" checked={values.noTrades} /> No trades <small>(NPC trades and trade evolutions)</small></label>
      <label class="check"><input type="checkbox" name="noLegendaries" checked={values.noLegendaries} /> No legendaries</label>
      <label class="check"><input type="checkbox" name="nuzlocke" checked={values.nuzlocke} /> Nuzlocke <small>(one start area each)</small></label>
    </div>
    <div class="buttons row">
      <button type="submit" class="primary">Build team <span class="htmx-indicator">…</span></button>
      <button type="submit" name="action" value="make" title="Build the team, write the script, generate the voice and render the video">Make video <span class="htmx-indicator">…</span></button>
      <label class="check"><input type="checkbox" name="quick" /> half-size preview <small>(faster)</small></label>
    </div>
    <p class="muted">Make video does everything in one go: team, script, narration, then the render. It runs in the background and takes about 15 minutes.</p>
  </form>
);

export const BuildPage: FC<{ games: string[]; values: BuildFormValues; error?: string }> = ({ games, values, error }) => (
  <Layout title="Build a team" active="/build">
    <h1>Build an in-game team</h1>
    <p class="lead">
      Picks six Pokémon that are really obtainable in the chosen game, with a route-by-route plan, moves and where each is learned, and a
      strategy for every gym leader and boss. The same seed always gives the same team.
    </p>
    <BuildForm games={games} values={values} error={error} />
  </Layout>
);
