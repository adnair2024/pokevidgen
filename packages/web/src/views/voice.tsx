import type { FC } from 'hono/jsx';
import { ENGINES, KOKORO_VOICES, type Manifest, type PronunciationsFile } from '@pokevidgen/core';
import type { Job } from '../jobs.js';
import type { VoiceSettings, VoiceStatus } from '../voice-service.js';
import { Notice } from './components.js';
import { Layout } from './layout.js';

export type VoiceView = {
  teamId: string;
  ready: { ready: boolean; missing: string[] };
  settings: VoiceSettings;
  status?: VoiceStatus;
  manifest?: Manifest;
  /** The saved audio still matches the script. */
  fresh: boolean;
  job?: Job;
  /** Preview audio file in out/, if one has been built. */
  previewFile?: string;
  error?: string;
};

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

const SettingsFields: FC<{ settings: VoiceSettings }> = ({ settings }) => (
  <>
    <label>
      Engine
      <select name="engine">
        {ENGINES.map((e) => <option value={e} selected={e === settings.engine}>{e === 'kokoro' ? 'Kokoro (free, local)' : e === 'piper' ? 'Piper (fast draft)' : 'ElevenLabs (paid)'}</option>)}
      </select>
    </label>
    <label>
      Voice <small>(Kokoro name, or ElevenLabs voice id)</small>
      <input name="voice" value={settings.voice} list="kokoro-voices" />
      <datalist id="kokoro-voices">{KOKORO_VOICES.map((v) => <option value={v} />)}</datalist>
    </label>
    <label>
      Speed
      <input name="speed" inputmode="decimal" value={String(settings.speed)} />
    </label>
    <label class="check"><input type="checkbox" name="respell" checked={settings.respell} /> Respell names <small>(untick to hear the plain spelling)</small></label>
  </>
);

/** Voice settings, per-line status, audio players and the generate / preview jobs. Polls itself while a job runs. */
export const VoicePanel: FC<{ view: VoiceView }> = ({ view }) => {
  const { teamId, ready, settings, status, manifest, fresh, job, previewFile, error } = view;
  const running = job?.status === 'running';
  const total = manifest ? manifest.lines.reduce((s, l) => s + l.durationMs, 0) : 0;
  const stale = !!manifest && !fresh;
  const target = { 'hx-target': '#voice-panel', 'hx-swap': 'outerHTML', 'hx-include': '#voice-form' } as const;
  return (
    <section id="voice-panel" class="card voice" hx-get={running ? `/teams/${teamId}/voice` : undefined} hx-trigger={running ? 'every 2s' : undefined} hx-swap="outerHTML">
      <h2>Voice</h2>
      {error && <Notice kind="error">{error}</Notice>}
      {!ready.ready && (
        <Notice kind="warn">
          Voice isn't set up yet (missing: {ready.missing.join(', ')}). Setting it up creates a Python environment and downloads about 500 MB of
          models (Kokoro and Whisper).{' '}
          <button hx-post="/voice/setup" hx-target="#voice-panel" hx-swap="outerHTML" disabled={running}>Set up voice</button>
        </Notice>
      )}
      <form id="voice-form" class="row voice-settings"><SettingsFields settings={settings} /></form>
      <div class="buttons row">
        <button hx-post={`/teams/${teamId}/voice/status`} {...target} disabled={running}>Check what would change</button>
        <button class="primary" hx-post={`/teams/${teamId}/voice/generate`} {...target} disabled={running || (!ready.ready && settings.engine === 'kokoro')}>Generate voice</button>
        <button hx-post={`/teams/${teamId}/voice/preview`} {...target} disabled={running || !manifest}>Build one preview file</button>
      </div>

      {manifest && (
        <p>
          <span class={`chip ${fresh ? 'done' : 'failed'}`}>{fresh ? 'matches the script' : 'script changed since this was generated'}</span>
          <span class="chip">narration {seconds(total)} s</span>
          {manifest.settings && <span class="chip">{manifest.settings.engine} · {manifest.settings.voice} · ×{manifest.settings.speed}{manifest.settings.respell ? '' : ' · plain names'}</span>}
        </p>
      )}
      {!manifest && <p class="muted">No voice yet. The video uses estimated timing until you generate one.</p>}
      {stale && <Notice kind="warn">The script changed, so renders ignore this audio and use estimated timing. Generate the voice again; only the changed lines are re-synthesized.</Notice>}
      {manifest && fresh && <p class="muted">Renders use this narration: the video is timed to it and captions follow the spoken words.</p>}

      {status && status.needed.length > 0 && (
        <div class="voice-status">
          <p>
            {status.needed.length === 0 ? 'Every line is already generated for these settings.' : `${status.needed.length} of ${status.lines.length} lines would be generated (${status.characters} characters).`}
            {status.cost && <> {status.cost}</>}
          </p>
        </div>
      )}

      {(status || manifest) && (
        <table class="table compact">
          <thead><tr><th>Line</th><th>Text</th><th>Status</th><th>Audio</th></tr></thead>
          <tbody>
            {(status?.lines ?? manifest!.lines.map((l) => ({ key: l.key, text: '', cached: true }))).map((l) => {
              const entry = manifest?.lines.find((m) => m.key === l.key);
              return (
                <tr>
                  <td><strong>{l.key}</strong></td>
                  <td class="muted">{'text' in l ? l.text : ''}</td>
                  <td><span class={`chip ${l.cached ? 'done' : 'warn'}`}>{l.cached ? 'ready' : 'needs generating'}</span></td>
                  <td>{entry && fresh ? <audio controls preload="none" src={`/voice/${teamId}/${entry.file.split('/').pop()}`} class="line-audio" /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {previewFile && (
        <div class="output">
          <h3>Whole narration</h3>
          <audio controls preload="metadata" src={`/out/${previewFile}`} class="wide-audio" />
        </div>
      )}

      {job && (
        <div class="job">
          <p><strong>{job.label}</strong> <span class={`chip ${job.status}`}>{job.status}</span></p>
          <pre class="log">{job.log.slice(-25).join('\n')}</pre>
        </div>
      )}
    </section>
  );
};

export const PronRow: FC<{ word: string; respelling: string; ready: boolean; saved?: boolean }> = ({ word, respelling, ready, saved }) => (
  <tr>
    <td><strong>{word}</strong><input type="hidden" name="word" value={word} /></td>
    <td><input name="respelling" value={respelling} placeholder="plain (spoken as written)" /></td>
    <td class="play">
      <button type="button" hx-post="/pronunciations/play" hx-include="closest tr" hx-target="next .clip" hx-swap="innerHTML" disabled={!ready}>Play</button>
      <span class="clip"></span>
    </td>
    <td>
      <button type="button" hx-post="/pronunciations/save" hx-include="closest tr" hx-target="closest tr" hx-swap="outerHTML">Save</button>
      <button type="button" class="danger" hx-post="/pronunciations/remove" hx-include="closest tr" hx-target="closest tr" hx-swap="outerHTML" hx-confirm={`Remove "${word}"?`}>Remove</button>
      {saved && <span class="chip done">saved</span>}
    </td>
  </tr>
);

/** Edit and audition how names are spoken. The text sent to the engine only; captions are never affected. */
export const PronunciationsPage: FC<{ file: PronunciationsFile; ready: boolean }> = ({ file, ready }) => (
  <Layout title="Pronunciations" active="/pronunciations">
    <h1>Pronunciations</h1>
    <p class="lead">
      Respellings change how names are <em>spoken</em>; captions always show the real spelling. Write the stress in capitals
      (<code>AG-uh-thuh</code>); it's sent to the engine in lower case. Press Play to hear it, then Save.
      {!ready && ' Voice is not set up yet, so Play is unavailable. Set it up from any team\'s Video tab or the Data page.'}
    </p>
    <table class="table compact prons">
      <thead><tr><th>Word</th><th>Respelling</th><th></th><th></th></tr></thead>
      <tbody>
        {Object.entries(file.words).sort(([a], [b]) => a.localeCompare(b)).map(([word, respelling]) => <PronRow word={word} respelling={respelling} ready={ready} />)}
      </tbody>
    </table>
    <form class="card form" method="post" action="/pronunciations/save">
      <h2>Add a word</h2>
      <div class="row">
        <label>Word <input name="word" placeholder="exeggutor" /></label>
        <label>Respelling <input name="respelling" placeholder="eg-ZEK-yoo-tor" /></label>
      </div>
      <button type="submit" class="primary">Add</button>
    </form>
  </Layout>
);
