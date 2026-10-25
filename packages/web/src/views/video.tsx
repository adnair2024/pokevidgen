import type { FC } from 'hono/jsx';
import { LIMITS, wordsOf, type Fact, type LintResult, type Run, type Team, type UploadRecord } from '@pokevidgen/core';
import type { Job } from '../jobs.js';
import type { RenderOutput } from '../store.js';
import { Notice, Sprite } from './components.js';
import type { Connection } from '../publish-service.js';
import { PublishPanel } from './publish.js';
import { VoicePanel, type VoiceView } from './voice.js';

const KIND_LABEL: Record<Fact['kind'], string> = { matchup: 'matchup', calc: 'calc', move: 'move', availability: 'where', role: 'role' };

const Stats: FC<{ lint: LintResult }> = ({ lint }) => {
  const { words, estimatedSeconds } = lint.stats;
  const inRange = estimatedSeconds >= LIMITS.totalSeconds.min && estimatedSeconds <= LIMITS.totalSeconds.max;
  const errors = lint.issues.filter((i) => i.level === 'error');
  const warnings = lint.issues.filter((i) => i.level === 'warning');
  return (
    <div class="card lintbar">
      <div class="stats">
        <span class={`chip ${inRange ? 'done' : 'failed'}`}>~{estimatedSeconds.toFixed(0)}s narration</span>
        <span class="chip">{words} words</span>
        <span class={`chip ${errors.length ? 'failed' : 'done'}`}>{errors.length} error{errors.length === 1 ? '' : 's'}</span>
        <span class="chip">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>
        <span class="muted">Target {LIMITS.totalSeconds.min}-{LIMITS.totalSeconds.max}s at speed 1.0 ({LIMITS.wordsPerSecond} words/s).</span>
      </div>
      {lint.issues.length > 0 && (
        <ul class="issues">
          {lint.issues.map((i) => <li class={i.level}><strong>{i.where}</strong>: {i.message}</li>)}
        </ul>
      )}
    </div>
  );
};

export type PublishView = { connection: Connection; record?: UploadRecord };

export const VideoPanel: FC<{ team: Team; run?: Run; lint?: LintResult; outputs?: RenderOutput[]; job?: Job; voice?: VoiceView; publish?: PublishView }> = ({ team, run, lint, outputs = [], job, voice, publish }) => {
  if (!run || !lint) {
    return (
      <div id="video-panel">
        <p class="lead">
          Turn this team into a draft-run short: a script written from the team's facts and damage calcs (no API key needed), checked by
          the lint, with a card for each pick.
        </p>
        <form hx-post={`/teams/${team.id}/run/generate`} hx-target="#video-panel" hx-swap="outerHTML">
          <button class="primary" type="submit">Generate script</button>
        </form>
      </div>
    );
  }
  const edited = run.picks.some((p) => p.line.source === 'edited');
  const factsBySpecies = (species: string) => run.facts.filter((f) => f.species === species);
  return (
    <div id="video-panel">
      <Stats lint={lint} />
      {voice && <VoicePanel view={voice} />}
      <RenderPanel team={team} outputs={outputs} job={job} voiceFresh={voice?.fresh} />
      {publish && <PublishPanel team={team} connection={publish.connection} record={publish.record} full={outputs.find((o) => o.kind === 'full')} />}
      <form hx-post={`/teams/${team.id}/run/generate`} hx-target="#video-panel" hx-swap="outerHTML" class="row regen"
        hx-confirm={edited ? 'This replaces your edited lines. Continue?' : undefined}>
        <label>Script seed <input name="seed" inputmode="numeric" pattern="[0-9]*" value={String(run.seed)} /></label>
        <button type="submit">Regenerate script</button>
      </form>
      <form hx-post={`/teams/${team.id}/run/save`} hx-target="#video-panel" hx-swap="outerHTML" class="script">
        <label>
          Hook <small>(over the empty grid, max {LIMITS.hookWords} words)</small>
          <input name="hook" value={run.voiceover.hook} data-count />
          <small class="count">{wordsOf(run.voiceover.hook).length} words</small>
        </label>
        {run.picks.map((p, i) => (
          <article class="card pick">
            <header>
              <Sprite species={p.pokemon} size={1} />
              <div>
                <strong>{i + 1}. {p.name}</strong>
                <span class="chip">{p.intro.kind === 'gymLeader' ? `card: ${p.intro.name}` : `card: ${p.intro.kind}`}</span>
                {p.effect && <span class="chip">effect: {p.effect}</span>}
                <span class={`chip ${p.line.source === 'edited' ? 'warn' : ''}`}>{p.line.source}</span>
              </div>
            </header>
            <textarea name={`line-${i}`} rows={3} data-count>{p.line.text}</textarea>
            <small class="count">{wordsOf(p.line.text).length} words (limit {LIMITS.pickMaxWords})</small>
            <details>
              <summary>Facts this line may cite ({p.line.factIds.length} cited)</summary>
              <ul class="facts">
                {factsBySpecies(p.pokemon).map((f) => (
                  <li>
                    <label class="check">
                      <input type="checkbox" name={`facts-${i}`} value={f.id} checked={p.line.factIds.includes(f.id)} />
                      <span class="chip">{KIND_LABEL[f.kind]}</span> {f.text}
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
        <label>
          Outro <small>(max {LIMITS.outroWords} words)</small>
          <input name="outro" value={run.voiceover.outro} data-count />
          <small class="count">{wordsOf(run.voiceover.outro).length} words</small>
        </label>
        <button class="primary" type="submit">Save and lint</button>
      </form>
    </div>
  );
};

const formatSize = (bytes: number): string => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/** Render controls, the live log, and the finished files. Polls itself while a render runs. */
export const RenderPanel: FC<{ team: Team; outputs: RenderOutput[]; job?: Job; error?: string; voiceFresh?: boolean }> = ({ team, outputs, job, error, voiceFresh }) => {
  const running = job?.status === 'running';
  const videos = outputs.filter((o) => o.kind === 'full' || o.kind === 'preview');
  const stills = outputs.filter((o) => o.kind === 'still');
  return (
    <section id="render-panel" class="card render" hx-get={running ? `/teams/${team.id}/render` : undefined} hx-trigger={running ? 'every 2s' : undefined} hx-swap="outerHTML">
      <h2>Render</h2>
      {error && <Notice kind="error">{error}</Notice>}
      <p class="muted">
        Renders the script with the current text, cards and effects. The preview is half size and quicker; the full render is 1080×1920 for
        posting. {voiceFresh ? 'The video is timed to the generated narration and includes the voice.' : 'Words are timed by an estimate until a voice is generated.'}
      </p>
      <div class="buttons row">
        <button class="primary" hx-post={`/teams/${team.id}/make`} hx-target="#render-panel" hx-swap="outerHTML" disabled={running} title="Voice, then the full render timed to it">Make video (voice + full render, about 15 min)</button>
        <button hx-post={`/teams/${team.id}/render/preview`} hx-target="#render-panel" hx-swap="outerHTML" disabled={running}>Render preview (about 5 min)</button>
        <button hx-post={`/teams/${team.id}/render/full`} hx-target="#render-panel" hx-swap="outerHTML" disabled={running}>Render full video (about 10 min)</button>
      </div>
      <form class="row frame-form" hx-post={`/teams/${team.id}/render/still`} hx-target="#render-panel" hx-swap="outerHTML">
        <label>Preview one frame <input name="frame" inputmode="numeric" pattern="[0-9]*" value="300" /></label>
        <button type="submit" disabled={running}>Render frame</button>
      </form>
      {job && (
        <div class="job">
          <p><strong>{job.label}</strong> <span class={`chip ${job.status}`}>{job.status}</span></p>
          <pre class="log">{job.log.slice(-30).join('\n')}</pre>
        </div>
      )}
      {videos.map((o) => (
        <div class="output">
          <h3>{o.kind === 'full' ? 'Full video' : 'Preview'} <small>{formatSize(o.size)} · {o.modified.toISOString().slice(0, 16).replace('T', ' ')}</small></h3>
          <video controls preload="metadata" src={`/out/${o.file}`} class="player" />
          <p><a class="button" href={`/out/${o.file}`} download>Download</a></p>
        </div>
      ))}
      {stills.length > 0 && (
        <div class="output">
          <h3>Frames</h3>
          <div class="stills">{stills.slice(0, 4).map((o) => <a href={`/out/${o.file}`}><img src={`/out/${o.file}`} alt={o.file} class="frame-thumb" loading="lazy" /></a>)}</div>
        </div>
      )}
    </section>
  );
};
