import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunSchema, TeamSchema, cacheDir, curatedDir, exists, type Run, type Team } from '@pokevidgen/core';

const ID = /^[a-z0-9-]+$/;

/** Team ids come from the URL, so they must never be able to name a path. */
export const isTeamId = (id: string): boolean => ID.test(id);

export type TeamSummary = { id: string; target: string; seed?: number; species: string[]; modified: Date };

export const createStore = (teamsDir: string) => ({
  async list(): Promise<TeamSummary[]> {
    if (!(await exists(teamsDir))) return [];
    const out: TeamSummary[] = [];
    for (const file of await readdir(teamsDir)) {
      if (!file.endsWith('.json')) continue;
      const path = join(teamsDir, file);
      try {
        const team = TeamSchema.parse(JSON.parse(await readFile(path, 'utf8')));
        out.push({ id: team.id, target: team.target, seed: team.seed, species: team.members.map((m) => m.set.species), modified: (await stat(path)).mtime });
      } catch {
        // A file that isn't a valid team is ignored here rather than breaking the list.
      }
    }
    return out.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  },

  async get(id: string): Promise<Team | undefined> {
    if (!isTeamId(id)) return undefined;
    const path = join(teamsDir, `${id}.json`);
    if (!(await exists(path))) return undefined;
    return TeamSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  },

  async save(team: Team): Promise<void> {
    if (!isTeamId(team.id)) throw new Error(`Invalid team id "${team.id}"`);
    await mkdir(teamsDir, { recursive: true });
    await writeFile(join(teamsDir, `${team.id}.json`), JSON.stringify(TeamSchema.parse(team), null, 2) + '\n');
  },

  async remove(id: string): Promise<boolean> {
    if (!isTeamId(id)) return false;
    const path = join(teamsDir, `${id}.json`);
    if (!(await exists(path))) return false;
    await rm(path);
    return true;
  },
});
export type Store = ReturnType<typeof createStore>;

export type DataStatus = {
  synced: Array<{ label: string; count: number; ok: boolean }>;
  curated: Array<{ label: string; ok: boolean }>;
};

const countFiles = async (dir: string): Promise<number> => ((await exists(dir)) ? (await readdir(dir)).length : 0);

/** What `pnpm data:sync` and the curated importers have produced so far. */
export const dataStatus = async (): Promise<DataStatus> => {
  const synced = [
    { label: 'Encounters (PokeAPI)', count: await countFiles(cacheDir('pokeapi', 'encounters')) },
    { label: 'Species data (PokeAPI)', count: await countFiles(cacheDir('pokeapi', 'species')) },
    { label: 'Sprites', count: await countFiles(cacheDir('sprites')) },
    { label: 'Smogon sets', count: await countFiles(cacheDir('smogon', 'sets')) },
  ].map((s) => ({ ...s, ok: s.count > 0 }));
  const files = ['bosses', 'learnsets', 'tms', 'progression'];
  const curated = await Promise.all(files.map(async (f) => ({ label: `${f}.json`, ok: await exists(curatedDir('gen1', `${f}.json`)) })));
  return { synced, curated };
};

/** Run files (`runs/<team id>.json`): the script and cards a video is rendered from. */
export const createRunStore = (runsDir: string) => ({
  async get(id: string): Promise<Run | undefined> {
    if (!isTeamId(id)) return undefined;
    const path = join(runsDir, `${id}.json`);
    if (!(await exists(path))) return undefined;
    return RunSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  },

  async save(run: Run): Promise<void> {
    if (!isTeamId(run.id)) throw new Error(`Invalid run id "${run.id}"`);
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, `${run.id}.json`), JSON.stringify(RunSchema.parse(run), null, 2) + '\n');
  },

  async remove(id: string): Promise<void> {
    if (isTeamId(id)) await rm(join(runsDir, `${id}.json`), { force: true });
  },
});
export type RunStore = ReturnType<typeof createRunStore>;

export type RenderOutput = { file: string; kind: 'preview' | 'full' | 'still' | 'voice'; size: number; modified: Date };

/** Rendered files for a team in `out/`: the full video, the half-size preview, and any stills. */
export const listOutputs = async (outDir: string, teamId: string): Promise<RenderOutput[]> => {
  if (!isTeamId(teamId) || !(await exists(outDir))) return [];
  const out: RenderOutput[] = [];
  for (const file of await readdir(outDir)) {
    const kind =
      file === `${teamId}.mp4` ? 'full'
      : file === `${teamId}-preview.mp4` ? 'preview'
      : file === `${teamId}-voice.wav` ? 'voice'
      : new RegExp(`^${teamId}-frame\\d+\\.png$`).test(file) ? 'still'
      : undefined;
    if (!kind) continue;
    const info = await stat(join(outDir, file));
    out.push({ file, kind, size: info.size, modified: info.mtime });
  }
  return out.sort((a, b) => b.modified.getTime() - a.modified.getTime());
};

export const isOutputFile = (name: string): boolean => /^[a-z0-9-]+(\.mp4|\.png|\.wav)$/.test(name);

const MUSIC_FILE = /^[a-z0-9][a-z0-9-]*\.(ogg|mp3|wav)$/;
export const isMusicFile = (name: string): boolean => MUSIC_FILE.test(name);

/** Music files the video can use (`packages/video/public/audio/`), by file name. */
export const listMusic = async (dir: string): Promise<string[]> =>
  (await exists(dir)) ? (await readdir(dir)).filter(isMusicFile).sort() : [];
