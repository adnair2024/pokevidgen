import type { Generation } from '@pokevidgen/core';
import type { FC } from 'hono/jsx';
import type { BossesFile } from '@pokevidgen/core';
import { Sprite, TypeChip } from './components.js';
import { Layout } from './layout.js';

export const BossesPage: FC<{ gen: Generation; game: string; games: string[]; file: BossesFile }> = ({ gen, game, games, file }) => (
  <Layout title="Bosses" active="/bosses/red">
    <h1>Bosses</h1>
    <nav class="tabs">{games.map((g) => <a href={`/bosses/${g}`} class={g === game ? 'active' : ''}>{g[0]!.toUpperCase() + g.slice(1)}</a>)}</nav>
    <p class="muted">Rosters and moves come from the game's own data (pret/pokered, commit {file.source.commit.slice(0, 7)}). Rival teams depend on your starter.</p>
    {[...file.bosses].sort((a, b) => a.order - b.order).map((boss) => (
      <details class="boss">
        <summary>
          <strong>{boss.name}</strong> <span class="muted">{boss.location}</span>
          {boss.badge && <span class="chip">{boss.badge} Badge</span>}
        </summary>
        {boss.variants.map((v) => (
          <>
            {v.rivalStarter && <h4>Rival starts with {gen.species.get(v.rivalStarter)?.name}</h4>}
            <table class="table compact">
              <tbody>
                {v.team.map((m) => (
                  <tr>
                    <td><Sprite species={m.species} size={1} /> <strong>{gen.species.get(m.species)?.name}</strong> <span class="muted">L{m.level}</span></td>
                    <td>{(gen.species.get(m.species)!.types as string[]).map((t) => <TypeChip type={t} />)}</td>
                    <td class="muted">{m.moves.map((id) => gen.moves.get(id)?.name ?? id).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
      </details>
    ))}
  </Layout>
);
