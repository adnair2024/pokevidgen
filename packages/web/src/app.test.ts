import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheDir, exists, type Manifest, type PronunciationsFile, type Team } from '@pokevidgen/core';
import { createApp } from './app.js';
import { createDeps, type Deps } from './deps.js';
import type { Job, Jobs } from './jobs.js';
import { createPublishService } from './publish-service.js';
import type { VoiceService } from './voice-service.js';

const hasCache = await exists(cacheDir('pokeapi', 'encounters'));
const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

let dir: string;
let runsDir: string;
let outDir: string;
let voiceDir: string;
let auditionDir: string;
let deps: Deps;
let publishDir: string;

/** TikTok's HTTP API, faked: records requests and answers the way the documentation says. */
const tiktok = {
  calls: [] as Array<{ url: string; method: string; headers: Record<string, string>; body?: string; bytes?: number }>,
  status: 'SEND_TO_USER_INBOX',
};
const fakeTikTok = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const body = init?.body;
  tiktok.calls.push({ url, method: init?.method ?? 'GET', headers, body: typeof body === 'string' || body instanceof URLSearchParams ? String(body) : undefined, bytes: body instanceof Uint8Array ? body.byteLength : undefined });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  if (url.endsWith('/v2/oauth/token/')) return json({ access_token: 'act', refresh_token: 'rft', open_id: 'oid', scope: 'video.upload', expires_in: 86400, refresh_expires_in: 31536000, token_type: 'Bearer' });
  if (url.endsWith('/inbox/video/init/')) return json({ data: { publish_id: 'v_pub_1', upload_url: 'https://upload.example/put?x=1' }, error: { code: 'ok', message: '', log_id: 'l' } });
  if (url.startsWith('https://upload.example/')) return new Response(null, { status: 201 });
  if (url.endsWith('/status/fetch/')) return json({ data: { status: tiktok.status }, error: { code: 'ok', message: '', log_id: 'l' } });
  return json({ error: { code: 'unexpected', message: url } }, 500);
}) as typeof fetch;

/** A voice service whose state the tests control; nothing is synthesized. */
const voiceState = {
  ready: true,
  manifest: undefined as Manifest | undefined,
  fresh: true,
  words: { agatha: 'AG-uh-thuh', raichu: 'RYE-choo' } as Record<string, string>,
  auditions: [] as string[],
};
const fakeVoice: VoiceService = {
  ready: async () => ({ ready: voiceState.ready, missing: voiceState.ready ? [] : ['Kokoro model'] }),
  status: async (run, settings) => ({
    lines: [{ key: 'hook', text: run.voiceover.hook, spoken: run.voiceover.hook, hash: 'h', cached: false }, ...run.picks.map((p) => ({ key: p.pokemon, text: p.line.text, spoken: p.line.text, hash: p.pokemon, cached: true }))],
    characters: 123, needed: ['hook'],
    cost: settings.engine === 'elevenlabs' ? '123 characters will be billed by ElevenLabs.' : undefined,
  }),
  manifest: async () => voiceState.manifest,
  fresh: async () => voiceState.fresh,
  audition: async (word, respelling) => { voiceState.auditions.push(`${word}=${respelling}`); return 'abc123.wav'; },
  pronunciations: async (): Promise<PronunciationsFile> => ({ source: { note: 'test' }, words: { ...voiceState.words } }),
  savePronunciations: async (f) => { voiceState.words = { ...f.words }; },
  runDir: () => voiceDir,
  auditionDir: () => auditionDir,
};

/** A job runner that records what it was asked to run instead of spawning anything. */
const started: Array<{ label: string; steps: string[][]; teamId?: string }> = [];
const jobList: Job[] = [];
const fakeJobs: Jobs = {
  start: () => { throw new Error('not used'); },
  startSteps: (label, steps, teamId) => {
    started.push({ label, steps: steps.map((s) => [...s]), teamId });
    const job: Job = { id: `job-${jobList.length}`, label, status: 'running', log: ['$ pnpm video render'], startedAt: 0, teamId };
    jobList.push(job);
    return job;
  },
  get: (id) => jobList.find((j) => j.id === id),
  latest: () => jobList.at(-1),
  latestFor: (teamId) => jobList.filter((j) => j.teamId === teamId).at(-1),
};
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pokevidgen-teams-'));
  runsDir = await mkdtemp(join(tmpdir(), 'pokevidgen-runs-'));
  outDir = await mkdtemp(join(tmpdir(), 'pokevidgen-out-'));
  voiceDir = await mkdtemp(join(tmpdir(), 'pokevidgen-voice-'));
  auditionDir = await mkdtemp(join(tmpdir(), 'pokevidgen-audition-'));
  publishDir = await mkdtemp(join(tmpdir(), 'pokevidgen-publish-'));
  const publish = createPublishService({
    fetch: fakeTikTok, dir: publishDir, credentials: () => ({ clientKey: 'ckey', clientSecret: 'csecret' }), redirectUri: () => 'http://127.0.0.1:3000/publish/tiktok/callback',
  });
  deps = createDeps({ teamsDir: dir, runsDir, outDir, jobs: fakeJobs, voice: fakeVoice, publish });
  app = createApp(deps);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(runsDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
  await rm(voiceDir, { recursive: true, force: true });
  await rm(auditionDir, { recursive: true, force: true });
  await rm(publishDir, { recursive: true, force: true });
});

describe('pages that need no data', () => {
  it('serves the static assets', async () => {
    const css = await app.request('/static/style.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    const js = await app.request('/static/htmx.js');
    expect(js.status).toBe(200);
    expect(await js.text()).toContain('htmx');
  });

  it('renders the dashboard, build, teams and data pages', async () => {
    for (const path of ['/', '/build', '/teams', '/data']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain('pokevidgen');
    }
  });

  it('returns 404 for unknown pages, teams, jobs and ids that try to name a path', async () => {
    expect((await app.request('/nope')).status).toBe(404);
    expect((await app.request('/teams/nope')).status).toBe(404);
    expect((await app.request('/teams/..%2F..%2Fpackage')).status).toBe(404);
    expect((await app.request('/teams/..%2F..%2Fpackage/delete', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/data/run/rm-rf', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/bosses/yellow')).status).toBe(404);
  });

  it('validates the build form before doing any work', async () => {
    const html = async (body: Record<string, string>) =>
      (await app.request('/build', { ...form(body), headers: { ...form(body).headers, 'HX-Request': 'true' } })).text();
    expect(await html({ game: 'red', seed: 'abc' })).toContain('Seed must be a whole number');
    expect(await html({ game: 'yellow' })).toContain('Unknown game');
    expect(await html({ game: 'red', seed: '0' })).toContain('1 or more');
  });
});

describe.skipIf(!hasCache)('with synced data', () => {
  let team: Team;

  beforeAll(async () => {
    const res = await app.request('/build', form({ game: 'red', seed: '7', noTrades: 'on' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/teams/red-s7');
    team = (await deps.store.get('red-s7'))!;
  });

  it('saved the team to the configured directory and lists it', async () => {
    expect(team.seed).toBe(7);
    expect(await (await app.request('/teams')).text()).toContain('red-s7');
  });

  it('uses HX-Redirect for htmx and picks a random seed when none is given', async () => {
    const res = await app.request('/build', { ...form({ game: 'blue', seed: '' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true' } });
    const url = res.headers.get('hx-redirect')!;
    expect(url).toMatch(/^\/teams\/blue-s\d+$/);
    expect((await deps.store.get(url.slice('/teams/'.length)))!.seed).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed gives the same team', async () => {
    await app.request('/build', form({ game: 'red', seed: '7', noTrades: 'on' }));
    expect((await deps.store.get('red-s7'))).toEqual(team);
  });

  it('shows planner errors in the form instead of failing', async () => {
    const res = await app.request('/build', { ...form({ game: 'red', must: 'mew' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('mew is not obtainable');
  });

  it('renders every tab and the downloads', async () => {
    for (const tab of ['overview', 'defense', 'bosses', 'writeup']) {
      const res = await app.request(`/teams/red-s7?tab=${tab}`);
      expect(res.status, tab).toBe(200);
    }
    const bosses = await (await app.request('/teams/red-s7?tab=bosses')).text();
    expect(bosses).toContain('Brock');
    expect(bosses).toContain('Lance');
    const md = await app.request('/teams/red-s7/download.md');
    expect(md.headers.get('content-disposition')).toContain('red-s7.md');
    expect(await md.text()).toContain('## Boss-by-boss strategy');
    expect(((await (await app.request('/teams/red-s7/team.json')).json()) as Team).id).toBe('red-s7');
  });

  it('renders the bosses reference for both games', async () => {
    for (const g of ['red', 'blue']) {
      const html = await (await app.request(`/bosses/${g}`)).text();
      expect(html).toContain('Giovanni');
      expect(html).toContain('Bide'); // Brock's Onix, from the game's own special-move table
    }
  });

  it('escapes text from a team file everywhere, including the markdown write-up', async () => {
    const evil = structuredClone(team);
    evil.id = 'evil-s1';
    evil.members[0]!.acquisition!.steps[0]!.where = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    await deps.store.save(evil);
    for (const tab of ['overview', 'bosses', 'writeup', 'defense']) {
      const html = await (await app.request(`/teams/evil-s1?tab=${tab}`)).text();
      expect(html, tab).not.toContain('<script>alert(1)');
      expect(html, tab).not.toMatch(/<img src=x/);
    }
    expect(await (await app.request('/teams/evil-s1?tab=overview')).text()).toContain('&lt;script&gt;alert(1)');
  });

  it('deletes a team, and HX-Redirects when asked from the team page', async () => {
    const res = await app.request('/teams/evil-s1/delete', form({ redirect: '1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('hx-redirect')).toBe('/teams');
    expect((await app.request('/teams/evil-s1')).status).toBe(404);
  });

  it('ignores files in the teams directory that are not valid teams', async () => {
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(join(dir, 'other.json'), JSON.stringify({ hello: 'world' }));
    const html = await (await app.request('/teams')).text();
    expect(html).toContain('red-s7');
    expect(html).not.toContain('broken');
  });

  describe('video script', () => {
    const post = (path: string, body: Record<string, string | string[]>) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
      return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    };

    it('offers to generate a script before one exists', async () => {
      const html = await (await app.request('/teams/red-s7?tab=video')).text();
      expect(html).toContain('Generate script');
      expect(html).not.toContain('Save and lint');
    });

    it('generates a script that passes lint, stores it as a run file, and shows every line', async () => {
      const html = await (await post('/teams/red-s7/run/generate', {})).text();
      expect(html).toContain('Save and lint');
      expect(html).toContain('0 errors');
      const run = (await deps.runs.get('red-s7'))!;
      expect(run.picks).toHaveLength(team.members.length);
      // JSX escapes apostrophes, so compare on the first plain word of each line.
      for (const p of run.picks) expect(html).toContain(p.line.text.split(' ').find((w) => /^[A-Za-z]+$/.test(w))!);
      expect(run.picks.every((p) => p.line.source === 'template')).toBe(true);
    });

    it('regenerates with a seed, and rejects a bad one', async () => {
      const before = (await deps.runs.get('red-s7'))!;
      await post('/teams/red-s7/run/generate', { seed: '12345' });
      const after = (await deps.runs.get('red-s7'))!;
      expect(after.seed).toBe(12345);
      expect(after.picks.map((p) => p.line.text)).not.toEqual(before.picks.map((p) => p.line.text));
      expect((await post('/teams/red-s7/run/generate', { seed: 'abc' })).status).toBe(400);
    });

    it('saves edits, marks them as edited, and lints the result', async () => {
      const run = (await deps.runs.get('red-s7'))!;
      const first = run.picks[0]!;
      const long = `${first.name} ` + 'goes on and on and on '.repeat(8);
      const html = await (await post('/teams/red-s7/run/save', {
        hook: 'A new hook', outro: run.voiceover.outro, 'line-0': long, 'facts-0': [...first.line.factIds, 'not.a.fact'],
      })).text();
      const saved = (await deps.runs.get('red-s7'))!;
      expect(saved.voiceover.hook).toBe('A new hook');
      expect(saved.picks[0]!.line.source).toBe('edited');
      expect(saved.picks[0]!.line.factIds).toEqual(first.line.factIds); // unknown ids are dropped
      expect(saved.picks[1]!.line.source).toBe('template'); // untouched lines stay generated
      expect(html).toMatch(/limit is 25/);
      expect(html).toMatch(/[1-9] errors?/);
    });

    it('does not let a blank field wipe a line, and escapes what you type', async () => {
      const run = (await deps.runs.get('red-s7'))!;
      const before = run.picks[1]!.line.text;
      const html = await (await post('/teams/red-s7/run/save', { 'line-1': '   ', 'line-2': `${run.picks[2]!.name} <script>alert(1)</script> wins.` })).text();
      expect((await deps.runs.get('red-s7'))!.picks[1]!.line.text).toBe(before);
      expect(html).not.toContain('<script>alert(1)');
    });

    it('404s for a team with no run, and for unknown teams', async () => {
      expect((await post('/teams/red-s7/run/save', {})).status).toBe(200);
      expect((await post('/teams/nope/run/generate', {})).status).toBe(404);
      expect((await post('/teams/nope/run/save', {})).status).toBe(404);
    });
  });

  describe('rendering', () => {
    const post = (path: string, body: Record<string, string> = {}) =>
      app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

    it('refuses to render before there is a script', async () => {
      await deps.runs.remove('red-s7');
      const res = await post('/teams/red-s7/render/preview');
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Generate the script first');
      expect(started).toHaveLength(0);
    });

    it('starts exactly the render command for the mode, using only the validated team id', async () => {
      await post('/teams/red-s7/run/generate');
      expect(await (await app.request('/teams/red-s7?tab=video')).text()).toContain('Render full video');

      await post('/teams/red-s7/render/preview');
      expect(started.at(-1)!.steps).toEqual([['video', 'render', 'runs/red-s7.json', '--scale', '0.5', '--out', 'out/red-s7-preview.mp4']]);
      expect(started.at(-1)!.teamId).toBe('red-s7');
    });

    it('allows one job at a time', async () => {
      const before = started.length;
      const res = await post('/teams/red-s7/render/full');
      expect(res.status).toBe(409);
      expect(await res.text()).toContain('already running');
      expect(started).toHaveLength(before);
    });

    it('renders full and still jobs once the previous one has finished, and validates the frame', async () => {
      jobList.at(-1)!.status = 'done';
      await post('/teams/red-s7/render/full');
      expect(started.at(-1)!.steps).toEqual([['video', 'render', 'runs/red-s7.json', '--out', 'out/red-s7.mp4']]);

      jobList.at(-1)!.status = 'done';
      const bad = await post('/teams/red-s7/render/still', { frame: '12; rm -rf /' });
      expect(bad.status).toBe(400);
      expect(await bad.text()).toContain('Frame must be a whole number');
      const count = started.length;
      await post('/teams/red-s7/render/still', { frame: '120' });
      expect(started).toHaveLength(count + 1);
      expect(started.at(-1)!.steps[0]).toEqual(['video', 'render', 'runs/red-s7.json', '--still', '120', '--scale', '0.5', '--out', 'out/red-s7-frame120.png']);
      jobList.at(-1)!.status = 'done';
    });

    it('404s for unknown modes and teams', async () => {
      expect((await post('/teams/red-s7/render/everything')).status).toBe(404);
      expect((await post('/teams/nope/render/full')).status).toBe(404);
      expect((await app.request('/teams/nope/render')).status).toBe(404);
    });

    it('lists this team\'s outputs only, and serves them with range support', async () => {
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'red-s7-preview.mp4'), Buffer.from('0123456789abcdefghij'));
      await writeFile(join(outDir, 'red-s7-frame120.png'), Buffer.from('png-bytes'));
      await writeFile(join(outDir, 'blue-s1.mp4'), Buffer.from('someone elses'));
      const html = await (await app.request('/teams/red-s7/render')).text();
      expect(html).toContain('/out/red-s7-preview.mp4');
      expect(html).toContain('/out/red-s7-frame120.png');
      expect(html).not.toContain('blue-s1');

      const full = await app.request('/out/red-s7-preview.mp4');
      expect(full.status).toBe(200);
      expect(full.headers.get('content-type')).toBe('video/mp4');
      expect(full.headers.get('accept-ranges')).toBe('bytes');
      expect(await full.text()).toBe('0123456789abcdefghij');

      const part = await app.request('/out/red-s7-preview.mp4', { headers: { Range: 'bytes=2-5' } });
      expect(part.status).toBe(206);
      expect(part.headers.get('content-range')).toBe('bytes 2-5/20');
      expect(await part.text()).toBe('2345');
      const tail = await app.request('/out/red-s7-preview.mp4', { headers: { Range: 'bytes=15-' } });
      expect(await tail.text()).toBe('fghij');
      expect((await app.request('/out/red-s7-preview.mp4', { headers: { Range: 'bytes=99-120' } })).status).toBe(416);
    });

    it('only serves plain output file names', async () => {
      expect((await app.request('/out/..%2Fpackage.json')).status).toBe(404);
      expect((await app.request('/out/secret.txt')).status).toBe(404);
      expect((await app.request('/out/missing.mp4')).status).toBe(404);
    });
  });

  describe('voice', () => {
    const post = (path: string, body: Record<string, string> = {}) =>
      app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const finish = () => { for (const j of jobList) j.status = 'done'; };
    const sampleManifest = async (): Promise<Manifest> => {
      const run = (await deps.runs.get('red-s7'))!;
      const line = (key: string) => ({ key, file: `voice/red-s7/${key}.wav`, durationMs: 4000, words: [{ word: 'word', startMs: 0, endMs: 300 }] });
      return { settings: { engine: 'kokoro', model: 'kokoro-v1.0', voice: 'af_heart', speed: 1.1, respell: true }, lines: [line('hook'), ...run.picks.map((p) => line(p.pokemon)), line('outro')] };
    };

    beforeAll(async () => {
      finish();
      await post('/teams/red-s7/run/generate');
    });

    it('offers setup when the voice is not installed, and disables generating with Kokoro', async () => {
      voiceState.ready = false;
      const html = await (await app.request('/teams/red-s7?tab=video')).text();
      expect(html).toMatch(/Voice isn(&#39;|')t set up yet/);
      expect(html).toContain('Kokoro model');
      voiceState.ready = true;
      expect(await (await app.request('/teams/red-s7?tab=video')).text()).not.toMatch(/set up yet/);
    });

    it('rejects bad engine, speed and voice values without starting anything', async () => {
      const before = started.length;
      expect(await (await post('/teams/red-s7/voice/generate', { engine: 'espeak', voice: 'af_heart', speed: '1.1' })).text()).toContain('Unknown engine');
      expect((await post('/teams/red-s7/voice/generate', { engine: 'kokoro', voice: 'af_heart', speed: '9' })).status).toBe(400);
      expect((await post('/teams/red-s7/voice/generate', { engine: 'kokoro', voice: 'af heart; rm -rf /', speed: '1.1' })).status).toBe(400);
      expect(started).toHaveLength(before);
    });

    it('checks what would change, and shows the ElevenLabs cost warning', async () => {
      const kokoro = await (await post('/teams/red-s7/voice/status', { engine: 'kokoro', voice: 'af_heart', speed: '1.1', respell: 'on' })).text();
      expect(kokoro).toMatch(/1 of \d+ lines would be generated/);
      expect(kokoro).toContain('needs generating');
      const paid = await (await post('/teams/red-s7/voice/status', { engine: 'elevenlabs', voice: 'abc', speed: '1.1' })).text();
      expect(paid).toContain('billed by ElevenLabs');
    });

    it('starts exactly the generate command, with --no-respell only when unticked, one job at a time', async () => {
      finish();
      await post('/teams/red-s7/voice/generate', { engine: 'kokoro', voice: 'am_michael', speed: '1.15', respell: 'on' });
      expect(started.at(-1)!.steps).toEqual([['voice', 'generate', 'runs/red-s7.json', '--engine', 'kokoro', '--voice', 'am_michael', '--speed', '1.15']]);
      const busy = await post('/teams/red-s7/voice/generate', { engine: 'kokoro', voice: 'af_heart', speed: '1.1' });
      expect(busy.status).toBe(409);
      finish();
      await post('/teams/red-s7/voice/generate', { engine: 'kokoro', voice: 'af_heart', speed: '1.1' });
      expect(started.at(-1)!.steps[0]).toContain('--no-respell');
      finish();
    });

    it('needs a generated voice before building the preview file, then starts it', async () => {
      voiceState.manifest = undefined;
      expect((await post('/teams/red-s7/voice/preview')).status).toBe(400);
      voiceState.manifest = await sampleManifest();
      await post('/teams/red-s7/voice/preview');
      expect(started.at(-1)!.steps).toEqual([['voice', 'preview', 'runs/red-s7.json']]);
      finish();
    });

    it('shows the measured narration and a player per line when the voice matches the script', async () => {
      voiceState.manifest = await sampleManifest();
      voiceState.fresh = true;
      const html = await (await app.request('/teams/red-s7?tab=video')).text();
      expect(html).toContain('matches the script');
      expect(html).toContain('/voice/red-s7/hook.wav');
      expect(html).toContain('The video is timed to the generated narration');
    });

    it('renders with the narration only when it still matches the script', async () => {
      voiceState.manifest = await sampleManifest();
      voiceState.fresh = true;
      finish();
      await post('/teams/red-s7/render/preview');
      expect(started.at(-1)!.steps[0]).toEqual(expect.arrayContaining(['--manifest', 'packages/video/public/voice/red-s7/manifest.json']));
      finish();

      voiceState.fresh = false; // the script changed after the voice was made
      const html = await (await app.request('/teams/red-s7?tab=video')).text();
      expect(html).toContain('script changed since this was generated');
      expect(html).toContain('estimated timing');
      await post('/teams/red-s7/render/preview');
      expect(started.at(-1)!.steps[0]).not.toContain('--manifest');
      voiceState.fresh = true;
      finish();
    });

    it('serves line audio with range support, and nothing outside the audio folders', async () => {
      await writeFile(join(voiceDir, 'hook.wav'), Buffer.from('0123456789'));
      const full = await app.request('/voice/red-s7/hook.wav');
      expect(full.headers.get('content-type')).toBe('audio/wav');
      expect(await full.text()).toBe('0123456789');
      const part = await app.request('/voice/red-s7/hook.wav', { headers: { Range: 'bytes=3-6' } });
      expect(part.status).toBe(206);
      expect(await part.text()).toBe('3456');
      expect((await app.request('/voice/red-s7/manifest.json')).status).toBe(404);
      expect((await app.request('/voice/red-s7/..%2Fsecret.wav')).status).toBe(404);
      expect((await app.request('/voice/..%2F..%2Fx/hook.wav')).status).toBe(404);
      expect((await app.request('/voice/red-s7/missing.wav')).status).toBe(404);
    });
  });

  describe('pronunciations page', () => {
    const post = (path: string, body: Record<string, string>, htmx = true) =>
      app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(htmx ? { 'HX-Request': 'true' } : {}) }, body: new URLSearchParams(body).toString() });

    it('lists the words, and shows Play as unavailable until the voice is installed', async () => {
      expect(await (await app.request('/pronunciations')).text()).toContain('AG-uh-thuh');
      voiceState.ready = false;
      expect(await (await app.request('/pronunciations')).text()).toContain('Play is unavailable');
      voiceState.ready = true;
    });

    it('auditions a respelling, and refuses an invalid word or a missing voice', async () => {
      const ok = await post('/pronunciations/play', { word: 'agatha', respelling: 'AG-uh-thuh' });
      expect(await ok.text()).toContain('/voice-audition/abc123.wav');
      expect(voiceState.auditions.at(-1)).toBe('agatha=AG-uh-thuh');
      expect((await post('/pronunciations/play', { word: '<script>', respelling: 'x' })).status).toBe(400);
      voiceState.ready = false;
      expect((await post('/pronunciations/play', { word: 'agatha', respelling: 'x' })).status).toBe(400);
      voiceState.ready = true;
    });

    it('saves, adds and removes entries, keeping the rest of the file', async () => {
      const saved = await post('/pronunciations/save', { word: 'Agatha', respelling: 'AG-uh-thah' });
      expect(await saved.text()).toContain('AG-uh-thah');
      expect(voiceState.words['agatha']).toBe('AG-uh-thah');
      expect(voiceState.words['raichu']).toBe('RYE-choo');

      // An empty respelling is valid: it marks the plain spelling as checked.
      expect((await post('/pronunciations/save', { word: 'squirtle', respelling: '' })).status).toBe(200);
      expect(voiceState.words['squirtle']).toBe('');
      const plain = await post('/pronunciations/save', { word: 'brock', respelling: 'BROK' }, false); // the add form is a normal POST
      expect(plain.status).toBe(302);
      expect(voiceState.words['brock']).toBe('BROK');

      expect((await post('/pronunciations/remove', { word: 'brock' })).status).toBe(200);
      expect(voiceState.words['brock']).toBeUndefined();
      expect((await post('/pronunciations/remove', { word: 'nope' })).status).toBe(404);
      expect((await post('/pronunciations/save', { word: '../etc', respelling: 'x' })).status).toBe(400);
    });

    it('serves audition clips only from the audition folder', async () => {
      await writeFile(join(auditionDir, 'abc123.wav'), Buffer.from('clip'));
      expect(await (await app.request('/voice-audition/abc123.wav')).text()).toBe('clip');
      expect((await app.request('/voice-audition/other.wav')).status).toBe(404);
      expect((await app.request('/voice-audition/..%2Fx.wav')).status).toBe(404);
    });
  });

  it('serves sprites for known species only', async () => {
    expect((await app.request('/sprites/pikachu.png')).headers.get('content-type')).toBe('image/png');
    expect((await app.request('/sprites/notapokemon.png')).status).toBe(404);
    expect((await app.request('/sprites/..%2Fsecret.png')).status).toBe(404);
  });

  describe('one-click make', () => {
    const htmx = { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true' };
    const finish = () => { for (const j of jobList) j.status = 'done'; };
    const makeForm = (fields: Record<string, string>) => ({ method: 'POST', headers: htmx, body: new URLSearchParams({ action: 'make', ...fields }).toString() });

    it('builds the team and script, then queues voice and the full render as one job', async () => {
      finish();
      voiceState.ready = true;
      const before = started.length;
      const res = await app.request('/build', makeForm({ game: 'red', seed: '11' }));
      expect(res.headers.get('hx-redirect')).toBe('/teams/red-s11?tab=video');
      expect(started).toHaveLength(before + 1);
      const job = started.at(-1)!;
      expect(job.teamId).toBe('red-s11');
      expect(job.steps.map((s) => s.slice(0, 2).join(' '))).toEqual(['voice generate', 'video render']);
      expect(job.steps[1]).toEqual(['video', 'render', 'runs/red-s11.json', '--manifest', 'packages/video/public/voice/red-s11/manifest.json', '--out', 'out/red-s11.mp4']);
      expect(await deps.store.get('red-s11')).toBeDefined();
      expect((await deps.runs.get('red-s11'))!.picks).toHaveLength(6);
    });

    it('builds a favorite-Pokémon video from the form', async () => {
      finish();
      const res = await app.request('/build', makeForm({ game: 'red', seed: '21', favorite: 'Charizard' }));
      expect(res.headers.get('hx-redirect')).toBe('/teams/red-fav-charizard-s21?tab=video');
      const team = (await deps.store.get('red-fav-charizard-s21'))!;
      expect(team.theme).toEqual({ favorite: 'charizard', mono: undefined });
      const run = (await deps.runs.get('red-fav-charizard-s21'))!;
      expect(run.picks[0]!.pokemon).toBe('charizard');
      expect(run.voiceover.hook).toContain('Charizard');
      expect(started.at(-1)!.teamId).toBe('red-fav-charizard-s21');
      finish();
    });

    it('offers the mono-type picker and builds a mono video from the form', async () => {
      finish();
      const page = await (await app.request('/build')).text();
      expect(page).toContain('name="favorite"');
      expect(page).toContain('name="mono"');
      expect(page).toContain('<option value="Psychic"');
      expect(page).not.toContain('<option value="Fairy"');
      const res = await app.request('/build', makeForm({ game: 'red', seed: '23', mono: 'Psychic' }));
      expect(res.headers.get('hx-redirect')).toBe('/teams/red-mono-psychic-s23?tab=video');
      expect((await deps.store.get('red-mono-psychic-s23'))!.theme?.mono).toBe('Psychic');
      finish();
    });

    it('reports a type the game cannot fill', async () => {
      finish();
      expect(await (await app.request('/build', makeForm({ game: 'red', seed: '24', mono: 'Dragon' }))).text()).toContain('Only 1 Dragon-type');
    });

    it('reports a favorite that cannot be had, and a malformed one', async () => {
      finish();
      expect(await (await app.request('/build', makeForm({ game: 'red', seed: '22', favorite: 'mew' }))).text()).toContain('mew is not obtainable');
      const bad = await app.request('/build', { ...form({ game: 'red', favorite: '<script>' }), headers: htmx });
      expect(await bad.text()).toContain('Favorite must be a Pokémon name');
    });

    it('renders half size when asked', async () => {
      finish();
      await app.request('/build', makeForm({ game: 'red', seed: '12', quick: 'on' }));
      expect(started.at(-1)!.steps[1]).toContain('--scale');
      expect(started.at(-1)!.steps[1]).toContain('out/red-s12-preview.mp4');
    });

    it('says so, and builds nothing, when the voice is not set up', async () => {
      finish();
      voiceState.ready = false;
      const before = started.length;
      const res = await app.request('/build', makeForm({ game: 'red', seed: '13' }));
      voiceState.ready = true;
      expect(await res.text()).toContain('Voice is not set up');
      expect(started).toHaveLength(before);
      expect(await deps.store.get('red-s13')).toBeUndefined();
    });

    it('refuses while another job is running', async () => {
      finish();
      await app.request('/build', makeForm({ game: 'red', seed: '14' }));
      const before = started.length;
      const res = await app.request('/build', makeForm({ game: 'red', seed: '15' }));
      expect(await res.text()).toContain('already running');
      expect(started).toHaveLength(before);
      expect(await deps.store.get('red-s15')).toBeUndefined();
      finish();
    });

    it('makes the video for an existing team, writing the script first if needed', async () => {
      finish();
      await app.request('/build', form({ game: 'red', seed: '16' }));
      expect(await deps.runs.get('red-s16')).toBeUndefined();
      const res = await app.request('/teams/red-s16/make', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await deps.runs.get('red-s16')).toBeDefined();
      expect(started.at(-1)!.label).toContain('red-s16');
      expect(started.at(-1)!.steps).toHaveLength(2);
      finish();
    });
  });

  describe('publishing to TikTok drafts', () => {
    const post = (path: string, body: Record<string, string> = {}) =>
      app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 50; i++) {
        const r = await deps.publish.record('red-s7');
        if (r && r.state !== 'uploading') return;
        await new Promise((r2) => setTimeout(r2, 20));
      }
    };

    it('explains the setup and is not connected at first', async () => {
      const page = await (await app.request('/publish')).text();
      expect(page).toContain('not connected');
      expect(page).toContain('http://127.0.0.1:3000/publish/tiktok/callback');
      expect(page).toContain('drafts');
    });

    it('sends the browser to TikTok with the draft-only scope and a PKCE challenge', async () => {
      const res = await app.request('/publish/tiktok/connect');
      expect(res.status).toBe(302);
      const url = new URL(res.headers.get('location')!);
      expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
      expect(url.searchParams.get('client_key')).toBe('ckey');
      expect(url.searchParams.get('scope')).toBe('video.upload');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[0-9a-f]{64}$/);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('client_secret')).toBeNull();
    });

    it('rejects a callback it did not start', async () => {
      const res = await app.request('/publish/tiktok/callback?code=abc&state=forged');
      expect(res.headers.get('location')).toContain('/publish?error=');
      expect((await deps.publish.connection()).connected).toBe(false);
    });

    it('does not upload anything before the account is connected', async () => {
      const res = await post('/teams/red-s7/publish/tiktok', { confirm: 'on' });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('not connected');
    });

    it('connects: the code is exchanged with the verifier and the tokens are stored privately', async () => {
      const state = new URL((await app.request('/publish/tiktok/connect')).headers.get('location')!).searchParams.get('state')!;
      const res = await app.request(`/publish/tiktok/callback?code=thecode&state=${state}`);
      expect(res.headers.get('location')).toBe('/publish?connected=1');
      const exchange = tiktok.calls.find((c) => c.url.endsWith('/v2/oauth/token/'))!;
      const form = new URLSearchParams(exchange.body);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('thecode');
      expect(form.get('code_verifier')).toMatch(/.{43,}/);
      expect((await deps.publish.connection()).connected).toBe(true);
      const { mode } = await stat(join(publishDir, 'tiktok.json'));
      expect(mode & 0o077).toBe(0);
      // The state is single use.
      const again = await app.request(`/publish/tiktok/callback?code=thecode&state=${state}`);
      expect(again.headers.get('location')).toContain('error=');
    });

    it('needs the confirmation box and a rendered full video', async () => {
      const noBox = await post('/teams/red-s7/publish/tiktok');
      expect(noBox.status).toBe(400);
      expect(await noBox.text()).toContain('Tick the box');
      const noVideo = await post('/teams/red-s7/publish/tiktok', { confirm: 'on' });
      expect(noVideo.status).toBe(400);
      expect(await noVideo.text()).toContain('Render the full video first');
      expect(tiktok.calls.some((c) => c.url.includes('/inbox/'))).toBe(false);
    });

    it('uploads the full video to the inbox and reports where the draft is', async () => {
      await writeFile(join(outDir, 'red-s7.mp4'), Buffer.alloc(1_234_567, 1));
      const res = await post('/teams/red-s7/publish/tiktok', { confirm: 'on' });
      expect(res.status).toBe(200);
      await settle();
      const init = tiktok.calls.find((c) => c.url.endsWith('/inbox/video/init/'))!;
      expect(init.headers['authorization']).toBe('Bearer act');
      expect(JSON.parse(init.body!)).toEqual({ source_info: { source: 'FILE_UPLOAD', video_size: 1_234_567, chunk_size: 1_234_567, total_chunk_count: 1 } });
      const put = tiktok.calls.find((c) => c.url.startsWith('https://upload.example/'))!;
      expect(put.method).toBe('PUT');
      expect(put.headers['content-range']).toBe('bytes 0-1234566/1234567');
      expect(put.headers['content-type']).toBe('video/mp4');
      expect(put.bytes).toBe(1_234_567);
      const record = await deps.publish.record('red-s7');
      expect(record).toMatchObject({ state: 'sent', publishId: 'v_pub_1' });
      const panel = await (await app.request('/teams/red-s7/publish')).text();
      expect(panel).toContain('TikTok inbox as a draft');
    });

    it('shows a TikTok failure', async () => {
      tiktok.status = 'FAILED';
      const panel = await (await app.request('/teams/red-s7/publish')).text();
      expect(panel).toContain('TikTok rejected the video');
      tiktok.status = 'SEND_TO_USER_INBOX';
    });

    it('disconnect removes the stored tokens', async () => {
      await post('/publish/tiktok/disconnect');
      expect((await deps.publish.connection()).connected).toBe(false);
    });
  });

});
