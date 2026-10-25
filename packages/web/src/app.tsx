import { randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { Marked } from 'marked';
import { z } from 'zod';
import {
  ENGINES, PlannerError, TeamSchema, buildRun, cacheDir, exists, forGen, gameIds, getGame, lintRun, planIngameTeam, teamToMarkdown,
  isEngineName, makeSteps, type Run, type Team,
} from '@pokevidgen/core';
import type { Deps } from './deps.js';
import { isJobName, isRenderMode, renderSteps, voicePreviewSteps, voiceSteps } from './jobs.js';
import { PublishPage, PublishPanel } from './views/publish.js';
import { defaultSettings, type VoiceSettings } from './voice-service.js';
import { dataStatus, isMusicFile, isOutputFile, isTeamId, listMusic, listOutputs } from './store.js';
import { BuildPage, BuildForm, DEFAULT_FORM, type BuildFormValues } from './views/build.js';
import { BossesPage } from './views/bosses.js';
import { DashboardPage } from './views/dashboard.js';
import { DataPage, JobPanel } from './views/data.js';
import { Layout } from './views/layout.js';
import { TeamPage, isTab } from './views/team.js';
import { MusicPanel, RenderPanel, VideoPanel } from './views/video.js';
import { PronRow, PronunciationsPage, VoicePanel, type VoiceView } from './views/voice.js';
import { TeamsPage } from './views/teams.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown for the write-up. Raw HTML inside it is escaped, never passed through. */
const marked = new Marked({ renderer: { html: ({ text }) => escapeHtml(text) } });

const connectMessage = (connected?: string, error?: string): { kind: 'error' | 'ok'; text: string } | undefined =>
  error ? { kind: 'error', text: `TikTok sign-in failed: ${error}` } : connected ? { kind: 'ok', text: 'TikTok connected.' } : undefined;

const BuildBody = z.object({
  game: z.string().refine((g) => gameIds().includes(g), 'Unknown game'),
  seed: z.string().trim().regex(/^\d*$/, 'Seed must be a whole number').optional().default(''),
  favorite: z.string().trim().max(40).regex(/^[A-Za-z0-9 .'\-:♀♂é]*$/, 'Favorite must be a Pokémon name').optional().default(''),
  mono: z.string().trim().max(20).regex(/^[A-Za-z]*$/, 'Unknown type').optional().default(''),
  must: z.string().optional().default(''),
  ban: z.string().optional().default(''),
  noTrades: z.string().optional(),
  noLegendaries: z.string().optional(),
  nuzlocke: z.string().optional(),
  action: z.string().optional(),
  quick: z.string().optional(),
});

const list = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

export const createApp = (deps: Deps): Hono => {
  const app = new Hono();
  const games = gameIds();

  // --- static assets
  app.get('/static/style.css', async (c) => {
    c.header('Content-Type', 'text/css; charset=utf-8');
    return c.body(await readFile(join(here, 'static', 'style.css'), 'utf8'));
  });
  app.get('/static/htmx.js', async (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(await readFile(require.resolve('htmx.org/dist/htmx.min.js'), 'utf8'));
  });
  app.get('/sprites/:file', async (c) => {
    const id = c.req.param('file').replace(/\.png$/, '');
    const dex = /^[a-z0-9]+$/.test(id) ? forGen(1).species.get(id)?.num : undefined;
    const path = dex ? cacheDir('sprites', `${dex}.png`) : undefined;
    if (!path || !(await exists(path))) return c.notFound();
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(await readFile(path));
  });

  /** Why a one-click make can't start right now, or undefined if it can. */
  const makeBlocker = async (): Promise<string | undefined> => {
    if (deps.jobs.latest()?.status === 'running') return 'A job is already running. Wait for it to finish.';
    const voice = await deps.voice.ready();
    if (!voice.ready) return `Voice is not set up (missing: ${voice.missing.join(', ')}). Open the Data page and run "Set up voice" first.`;
    return undefined;
  };

  /** Lint the script, then queue narration and the render as one background job. */
  const startMake = async (team: Team, run: Run, quick: boolean): Promise<string | undefined> => {
    const lint = lintRun(run, await deps.lintContext(team.target));
    const errors = lint.issues.filter((i) => i.level === 'error');
    if (errors.length) return `The script has problems, so nothing was rendered: ${errors.map((e) => `${e.where}: ${e.message}`).join('; ')}`;
    deps.jobs.startSteps(`Make video (${team.id})`, makeSteps(team.id, defaultSettings(), quick ? 'preview' : 'full'), team.id);
    return undefined;
  };

  // --- pages
  app.get('/', async (c) =>
    c.html(<DashboardPage games={games} teams={await deps.store.list()} status={await dataStatus()} />),
  );

  app.get('/build', (c) => c.html(<BuildPage games={games} values={DEFAULT_FORM} />));

  app.post('/build', async (c) => {
    const body = await c.req.parseBody();
    const parsed = BuildBody.safeParse(body);
    const values: BuildFormValues = {
      game: String(body['game'] ?? 'red'),
      seed: String(body['seed'] ?? ''),
      favorite: String(body['favorite'] ?? ''),
      mono: String(body['mono'] ?? ''),
      must: String(body['must'] ?? ''),
      ban: String(body['ban'] ?? ''),
      noTrades: body['noTrades'] === 'on',
      noLegendaries: body['noLegendaries'] === 'on',
      nuzlocke: body['nuzlocke'] === 'on',
    };
    const fail = (error: string) =>
      c.req.header('HX-Request') ? c.html(<BuildForm games={games} values={values} error={error} />) : c.html(<BuildPage games={games} values={values} error={error} />, 400);

    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join('. '));
    const input = parsed.data;
    const make = input.action === 'make';
    if (make) {
      const blocked = await makeBlocker();
      if (blocked) return fail(blocked);
    }
    const seed = input.seed === '' ? randomInt(1, 2 ** 31) : Number(input.seed);
    if (!Number.isSafeInteger(seed) || seed < 1) return fail('Seed must be a whole number of 1 or more.');

    try {
      const data = await deps.data(input.game);
      const team = TeamSchema.parse(
        await planIngameTeam(data, {
          seed,
          favorite: input.favorite || undefined,
          mono: input.mono || undefined,
          must: list(input.must),
          ban: list(input.ban),
          noTrades: input.noTrades === 'on',
          noLegendaries: input.noLegendaries === 'on',
          nuzlocke: input.nuzlocke === 'on',
        }),
      );
      await deps.store.save(team);
      let url = `/teams/${team.id}`;
      if (make) {
        const run = await buildRun(data, team);
        await deps.runs.save(run);
        const problem = await startMake(team, run, input.quick === 'on');
        if (problem) return fail(`${problem} The team was saved as ${team.id}.`);
        url += '?tab=video';
      }
      if (c.req.header('HX-Request')) {
        c.header('HX-Redirect', url);
        return c.body(null);
      }
      return c.redirect(url);
    } catch (err) {
      if (err instanceof PlannerError) return fail(err.message);
      if (err instanceof Error && /data:sync|ENOENT/.test(err.message)) {
        return fail('Data is missing. Open the Data page and run a sync, then try again.');
      }
      throw err;
    }
  });

  app.get('/teams', async (c) => c.html(<TeamsPage teams={await deps.store.list()} />));

  app.get('/teams/:id', async (c) => {
    const team = await deps.store.get(c.req.param('id'));
    if (!team) return c.html(<Layout title="Not found"><h1>No such team</h1><p><a href="/teams">Back to teams</a></p></Layout>, 404);
    const tabParam = c.req.query('tab') ?? 'overview';
    const tab = isTab(tabParam) ? tabParam : 'overview';
    const data = await deps.data(team.target);
    const writeupHtml = tab === 'writeup' ? await marked.parse(teamToMarkdown(data.gen, team, data.game.name)) : '';
    const run = tab === 'video' ? await deps.runs.get(team.id) : undefined;
    const lint = run ? lintRun(run, await deps.lintContext(team.target)) : undefined;
    const outputs = tab === 'video' ? await listOutputs(deps.outDir, team.id) : [];
    const voice = tab === 'video' && run ? await voiceView(team.id) : undefined;
    const publish = tab === 'video' && run ? { connection: await deps.publish.connection(), record: await deps.publish.record(team.id) } : undefined;
    return c.html(<TeamPage gen={data.gen} team={team} gameName={data.game.name} tab={tab} writeupHtml={writeupHtml} run={run} lint={lint} outputs={outputs} job={deps.jobs.latestFor(team.id)} voice={voice} publish={publish} music={await listMusic(deps.musicDir)} />);
  });

  app.get('/teams/:id/download.md', async (c) => {
    const team = await deps.store.get(c.req.param('id'));
    if (!team) return c.notFound();
    const data = await deps.data(team.target);
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${team.id}.md"`);
    return c.body(teamToMarkdown(data.gen, team, data.game.name));
  });

  app.get('/teams/:id/team.json', async (c) => {
    const team = await deps.store.get(c.req.param('id'));
    return team ? c.json(team) : c.notFound();
  });

  app.post('/teams/:id/delete', async (c) => {
    const id = c.req.param('id');
    if (!isTeamId(id) || !(await deps.store.remove(id))) return c.notFound();
    if ((await c.req.parseBody())['redirect']) {
      c.header('HX-Redirect', '/teams');
    }
    return c.body(null);
  });

  // --- video script (M7): generate, edit, lint
  const panel = async (teamId: string, run: Run | undefined) => {
    const team = (await deps.store.get(teamId))!;
    const lint = run ? lintRun(run, await deps.lintContext(team.target)) : undefined;
    return <VideoPanel team={team} run={run} lint={lint} outputs={await listOutputs(deps.outDir, teamId)} job={deps.jobs.latestFor(teamId)} voice={run ? await voiceView(teamId) : undefined} music={await listMusic(deps.musicDir)} />;
  };

  app.post('/teams/:id/run/generate', async (c) => {
    const team = await deps.store.get(c.req.param('id'));
    if (!team) return c.notFound();
    const body = await c.req.parseBody();
    const raw = String(body['seed'] ?? '').trim();
    if (raw !== '' && !/^\d+$/.test(raw)) return c.html(await panel(team.id, await deps.runs.get(team.id)), 400);
    const run = await buildRun(await deps.data(team.target), team, raw === '' ? {} : { seed: Number(raw) });
    await deps.runs.save(run);
    return c.html(await panel(team.id, run));
  });

  /** Choose the background track (or none). Only files that are in the music folder can be chosen. */
  app.post('/teams/:id/run/music', async (c) => {
    const id = c.req.param('id');
    const run = await deps.runs.get(id);
    const team = await deps.store.get(id);
    if (!run || !team) return c.notFound();
    const choice = String((await c.req.parseBody())['music'] ?? '');
    const files = await listMusic(deps.musicDir);
    if (choice !== '' && !files.includes(choice)) return c.notFound();
    const next: Run = { ...run, music: choice === '' ? null : `audio/${choice}` };
    await deps.runs.save(next);
    return c.html(<MusicPanel team={team} run={next} files={files} />);
  });

  app.get('/music/:file', async (c) => {
    const file = c.req.param('file');
    const path = join(deps.musicDir, file);
    return isMusicFile(file) && (await exists(path)) ? sendFile(c, path, typeOf(file)) : c.notFound();
  });

  app.post('/teams/:id/run/save', async (c) => {
    const id = c.req.param('id');
    const run = await deps.runs.get(id);
    if (!run) return c.notFound();
    const body = await c.req.parseBody({ all: true });
    const text = (k: string): string => String(Array.isArray(body[k]) ? body[k][0] : (body[k] ?? '')).replace(/\s+/g, ' ').trim();
    const list = (k: string): string[] => (Array.isArray(body[k]) ? body[k] : body[k] === undefined ? [] : [body[k]]).map(String);

    const next: Run = structuredClone(run);
    if (text('hook')) next.voiceover.hook = text('hook');
    if (text('outro')) next.voiceover.outro = text('outro');
    const known = new Set(run.facts.map((f) => f.id));
    for (const [i, pick] of next.picks.entries()) {
      const t = text(`line-${i}`);
      const ids = list(`facts-${i}`).filter((f) => known.has(f));
      if (!t) continue;
      const changed = t !== pick.line.text || ids.join() !== pick.line.factIds.join();
      pick.line = { text: t, factIds: ids, source: changed ? 'edited' : pick.line.source };
    }
    await deps.runs.save(next);
    return c.html(await panel(id, next));
  });

  // --- rendering (M8): background jobs and the files they write
  const renderPanel = async (teamId: string, error?: string) => {
    const team = (await deps.store.get(teamId))!;
    const run = await deps.runs.get(teamId);
    const manifest = run ? await deps.voice.manifest(teamId) : undefined;
    const voiceFresh = !!run && !!manifest && (await deps.voice.fresh(run, manifest));
    return <RenderPanel team={team} outputs={await listOutputs(deps.outDir, teamId)} job={deps.jobs.latestFor(teamId)} error={error} voiceFresh={voiceFresh} />;
  };

  app.get('/teams/:id/render', async (c) => {
    if (!(await deps.store.get(c.req.param('id')))) return c.notFound();
    return c.html(await renderPanel(c.req.param('id')));
  });

  app.post('/teams/:id/render/:mode', async (c) => {
    const id = c.req.param('id');
    const mode = c.req.param('mode');
    if (!(await deps.store.get(id))) return c.notFound();
    if (!isRenderMode(mode)) return c.notFound();
    if (!(await deps.runs.get(id))) return c.html(await renderPanel(id, 'Generate the script first.'), 400);
    const running = deps.jobs.latest();
    if (running?.status === 'running') return c.html(await renderPanel(id, 'A job is already running. Wait for it to finish.'), 409);

    const frameRaw = String((await c.req.parseBody())['frame'] ?? '0').trim();
    if (!/^\d{1,6}$/.test(frameRaw)) return c.html(await renderPanel(id, 'Frame must be a whole number.'), 400);
    const label = mode === 'still' ? `Render frame ${frameRaw}` : mode === 'preview' ? 'Render preview' : 'Render full video';
    const manifest = await deps.voice.manifest(id);
    const withVoice = !!manifest && (await deps.voice.fresh((await deps.runs.get(id))!, manifest));
    deps.jobs.startSteps(`${label} (${id})`, renderSteps(id, mode, Number(frameRaw), withVoice), id);
    return c.html(await renderPanel(id));
  });

  /** Voice + full render for a team whose script exists (generated here if it doesn't). */
  app.post('/teams/:id/make', async (c) => {
    const id = c.req.param('id');
    const team = await deps.store.get(id);
    if (!team) return c.notFound();
    const blocked = await makeBlocker();
    if (blocked) return c.html(await renderPanel(id, blocked), 409);
    const run = (await deps.runs.get(id)) ?? (await buildRun(await deps.data(team.target), team));
    await deps.runs.save(run);
    const problem = await startMake(team, run, false);
    return c.html(await renderPanel(id, problem), problem ? 400 : 200);
  });

  /** Send a file, with Range support so a browser can seek in video and audio. */
  const sendFile = async (c: { req: { header: (n: string) => string | undefined } }, path: string, type: string): Promise<Response> => {
    const { size } = await stat(path);
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('Range') ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
        status: 206,
        headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) },
    });
  };

  const OUT_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
  const typeOf = (name: string): string => OUT_TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream';

  /** Rendered files (video, frames, the joined narration). */
  app.get('/out/:file', async (c) => {
    const name = c.req.param('file');
    const path = join(deps.outDir, name);
    if (!isOutputFile(name) || !(await exists(path))) return c.notFound();
    return sendFile(c, path, typeOf(name));
  });

  // --- voice (M9): settings, status, generate and preview jobs, audio files
  const AUDIO_FILE = /^[a-z0-9-]+\.(wav|mp3)$/;

  const parseVoiceSettings = (body: Record<string, unknown>): { settings: VoiceSettings } | { error: string } => {
    const d = defaultSettings();
    const engine = String(body['engine'] ?? d.engine);
    const voice = String(body['voice'] ?? d.voice).trim();
    const speed = Number(String(body['speed'] ?? d.speed).trim());
    if (!isEngineName(engine)) return { error: `Unknown engine. Choose one of: ${ENGINES.join(', ')}.` };
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(voice)) return { error: 'Voice may only contain letters, digits and _ . : -' };
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) return { error: 'Speed must be a number between 0.5 and 2.' };
    return { settings: { engine, voice, speed, respell: body['respell'] === 'on' } };
  };

  const voiceView = async (teamId: string, settings?: VoiceSettings, extra: Partial<VoiceView> = {}): Promise<VoiceView> => {
    const run = (await deps.runs.get(teamId))!;
    const manifest = await deps.voice.manifest(teamId);
    const used: VoiceSettings = settings ?? (manifest?.settings ? { ...manifest.settings, engine: isEngineName(manifest.settings.engine) ? manifest.settings.engine : 'kokoro' } : defaultSettings());
    const outputs = await listOutputs(deps.outDir, teamId);
    return {
      teamId, settings: used, manifest, fresh: manifest ? await deps.voice.fresh(run, manifest) : false,
      // Per-line status is a cheap dry run (hashing and file checks), so the table always shows what is really stale.
      status: await deps.voice.status(run, used),
      ready: await deps.voice.ready(), job: deps.jobs.latestFor(teamId), previewFile: outputs.find((o) => o.kind === 'voice')?.file, ...extra,
    };
  };
  const voicePanel = async (teamId: string, settings?: VoiceSettings, extra: Partial<VoiceView> = {}) => <VoicePanel view={await voiceView(teamId, settings, extra)} />;

  app.get('/teams/:id/voice', async (c) => {
    const id = c.req.param('id');
    if (!(await deps.store.get(id)) || !(await deps.runs.get(id))) return c.notFound();
    return c.html(await voicePanel(id));
  });

  app.post('/teams/:id/voice/status', async (c) => {
    const id = c.req.param('id');
    const run = await deps.runs.get(id);
    if (!run || !(await deps.store.get(id))) return c.notFound();
    const parsed = parseVoiceSettings(await c.req.parseBody());
    if ('error' in parsed) return c.html(await voicePanel(id, undefined, { error: parsed.error }), 400);
    return c.html(await voicePanel(id, parsed.settings, { status: await deps.voice.status(run, parsed.settings) }));
  });

  app.post('/teams/:id/voice/generate', async (c) => {
    const id = c.req.param('id');
    if (!(await deps.runs.get(id)) || !(await deps.store.get(id))) return c.notFound();
    const parsed = parseVoiceSettings(await c.req.parseBody());
    if ('error' in parsed) return c.html(await voicePanel(id, undefined, { error: parsed.error }), 400);
    if (deps.jobs.latest()?.status === 'running') return c.html(await voicePanel(id, parsed.settings, { error: 'A job is already running. Wait for it to finish.' }), 409);
    deps.jobs.startSteps(`Generate voice (${id})`, voiceSteps(id, parsed.settings), id);
    return c.html(await voicePanel(id, parsed.settings));
  });

  app.post('/teams/:id/voice/preview', async (c) => {
    const id = c.req.param('id');
    if (!(await deps.runs.get(id)) || !(await deps.store.get(id))) return c.notFound();
    if (!(await deps.voice.manifest(id))) return c.html(await voicePanel(id, undefined, { error: 'Generate the voice first.' }), 400);
    if (deps.jobs.latest()?.status === 'running') return c.html(await voicePanel(id, undefined, { error: 'A job is already running. Wait for it to finish.' }), 409);
    deps.jobs.startSteps(`Build narration preview (${id})`, voicePreviewSteps(id), id);
    return c.html(await voicePanel(id));
  });

  app.post('/teams/:id/voice/setup', async (c) => {
    const id = c.req.param('id');
    if (!(await deps.runs.get(id)) || !(await deps.store.get(id))) return c.notFound();
    if (deps.jobs.latest()?.status === 'running') return c.html(await voicePanel(id, undefined, { error: 'A job is already running. Wait for it to finish.' }), 409);
    deps.jobs.start('voice-setup', id);
    return c.html(await voicePanel(id));
  });

  /** A generated line's audio. */
  app.get('/voice/:runId/:file', async (c) => {
    const { runId, file } = c.req.param();
    if (!isTeamId(runId) || !AUDIO_FILE.test(file)) return c.notFound();
    const path = join(deps.voice.runDir(runId), file);
    return (await exists(path)) ? sendFile(c, path, typeOf(file)) : c.notFound();
  });

  app.get('/voice-audition/:file', async (c) => {
    const file = c.req.param('file');
    const path = join(deps.voice.auditionDir(), file);
    return AUDIO_FILE.test(file) && (await exists(path)) ? sendFile(c, path, typeOf(file)) : c.notFound();
  });

  // --- publishing (TikTok inbox drafts only)
  const publishPanel = async (teamId: string, error?: string) => {
    const team = (await deps.store.get(teamId))!;
    const record = await deps.publish.refresh(teamId);
    const full = (await listOutputs(deps.outDir, teamId)).find((o) => o.kind === 'full');
    return <PublishPanel team={team} connection={await deps.publish.connection()} full={full} record={record} error={error} />;
  };

  app.get('/publish', async (c) => c.html(<PublishPage connection={await deps.publish.connection()} message={connectMessage(c.req.query('connected'), c.req.query('error'))} />));

  app.get('/publish/tiktok/connect', async (c) => {
    try {
      return c.redirect(deps.publish.connectUrl());
    } catch (err) {
      return c.html(<PublishPage connection={await deps.publish.connection()} message={{ kind: 'error', text: (err as Error).message }} />, 400);
    }
  });

  app.get('/publish/tiktok/callback', async (c) => {
    try {
      await deps.publish.callback({
        code: c.req.query('code'), state: c.req.query('state'), error: c.req.query('error'), error_description: c.req.query('error_description'),
      });
      return c.redirect('/publish?connected=1');
    } catch (err) {
      return c.redirect(`/publish?error=${encodeURIComponent((err as Error).message.slice(0, 300))}`);
    }
  });

  app.post('/publish/tiktok/disconnect', async (c) => {
    await deps.publish.disconnect();
    return c.redirect('/publish');
  });

  app.get('/teams/:id/publish', async (c) => {
    if (!(await deps.store.get(c.req.param('id')))) return c.notFound();
    return c.html(await publishPanel(c.req.param('id')));
  });

  app.post('/teams/:id/publish/tiktok', async (c) => {
    const id = c.req.param('id');
    if (!(await deps.store.get(id))) return c.notFound();
    if ((await c.req.parseBody())['confirm'] !== 'on') return c.html(await publishPanel(id, 'Tick the box to confirm you want this video sent to your TikTok drafts.'), 400);
    const connection = await deps.publish.connection();
    if (!connection.connected) return c.html(await publishPanel(id, 'TikTok is not connected.'), 400);
    const full = (await listOutputs(deps.outDir, id)).find((o) => o.kind === 'full');
    if (!full) return c.html(await publishPanel(id, 'Render the full video first.'), 400);
    try {
      await deps.publish.send(id, join(deps.outDir, full.file));
    } catch (err) {
      return c.html(await publishPanel(id, (err as Error).message), 502);
    }
    return c.html(await publishPanel(id));
  });

  // --- pronunciations
  const WORD = /^[a-z][a-z'.]{0,40}$/;
  app.get('/pronunciations', async (c) => c.html(<PronunciationsPage file={await deps.voice.pronunciations()} ready={(await deps.voice.ready()).ready} />));

  app.post('/pronunciations/play', async (c) => {
    const body = await c.req.parseBody();
    const word = String(body['word'] ?? '').trim().toLowerCase();
    const respelling = String(body['respelling'] ?? '').trim();
    if (!WORD.test(word) || respelling.length > 80) return c.html(<span class="muted">Not a valid word.</span>, 400);
    if (!(await deps.voice.ready()).ready) return c.html(<span class="muted">Voice is not set up.</span>, 400);
    try {
      const file = await deps.voice.audition(word, respelling, defaultSettings());
      return c.html(<audio controls autoplay src={`/voice-audition/${file}`} />);
    } catch (err) {
      return c.html(<span class="muted">{(err as Error).message}</span>, 500);
    }
  });

  app.post('/pronunciations/save', async (c) => {
    const body = await c.req.parseBody();
    const word = String(body['word'] ?? '').trim().toLowerCase();
    const respelling = String(body['respelling'] ?? '').trim();
    const htmx = !!c.req.header('HX-Request');
    if (!WORD.test(word) || respelling.length > 80) {
      return htmx ? c.html(<span class="chip failed">Needs a valid word</span>, 400) : c.redirect('/pronunciations');
    }
    const file = await deps.voice.pronunciations();
    await deps.voice.savePronunciations({ ...file, words: { ...file.words, [word]: respelling } });
    if (!htmx) return c.redirect('/pronunciations');
    return c.html(<PronRow word={word} respelling={respelling} ready={(await deps.voice.ready()).ready} saved />);
  });

  app.post('/pronunciations/remove', async (c) => {
    const word = String((await c.req.parseBody())['word'] ?? '').trim().toLowerCase();
    const file = await deps.voice.pronunciations();
    if (!(word in file.words)) return c.notFound();
    const words = Object.fromEntries(Object.entries(file.words).filter(([w]) => w !== word));
    await deps.voice.savePronunciations({ ...file, words });
    return c.body(null);
  });

  app.get('/bosses/:game', async (c) => {
    const game = c.req.param('game');
    if (!games.includes(game)) return c.notFound();
    const data = await deps.data(game);
    return c.html(<BossesPage gen={data.gen} game={game} games={games} file={data.bosses} />);
  });

  // --- data
  app.get('/data', async (c) => c.html(<DataPage status={await dataStatus()} job={deps.jobs.latest()} />));
  app.post('/data/run/:name', (c) => {
    const name = c.req.param('name');
    if (!isJobName(name)) return c.notFound();
    const running = deps.jobs.latest();
    if (running?.status === 'running') return c.html(<JobPanel job={running} />);
    return c.html(<JobPanel job={deps.jobs.start(name)} />);
  });
  app.get('/data/job/:id', (c) => {
    const job = deps.jobs.get(c.req.param('id'));
    return job ? c.html(<JobPanel job={job} />) : c.notFound();
  });

  app.notFound((c) => c.html(<Layout title="Not found"><h1>Not found</h1><p><a href="/">Dashboard</a></p></Layout>, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.html(<Layout title="Error"><h1>Something went wrong</h1><pre class="log">{err.message}</pre><p><a href="/">Dashboard</a></p></Layout>, 500);
  });

  return app;
};

// Referenced only for the game name in views that need it.
export const gameName = (id: string): string => getGame(id).name;
