import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { COMPOSITION_ID } from './Root.js';
import { ManifestSchema, RunSchema, type Manifest, type Run } from './run.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageRoot = resolve(here, '..');
export const repoRoot = resolve(packageRoot, '../..');

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

/**
 * Remotion downloads its own Chrome, which crashes on some systems (it segfaults on this one), so prefer
 * a browser already installed. POKEVIDGEN_BROWSER overrides; otherwise the first of these that exists.
 */
const BROWSER_CANDIDATES = ['/usr/bin/brave', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];

export const findBrowser = async (): Promise<string | undefined> => {
  const fromEnv = process.env['POKEVIDGEN_BROWSER'];
  if (fromEnv) return fromEnv;
  for (const candidate of BROWSER_CANDIDATES) if (await exists(candidate)) return candidate;
  return undefined;
};

/** Webpack resolves `./X.js` imports to `X.tsx`, the way TypeScript does. */
export const webpackOverride = <T extends { resolve?: object }>(config: T): T => ({
  ...config,
  resolve: { ...config.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] } },
});

/** Copy what the composition reads through staticFile(): sprites for the run's picks, and the pixel font. */
export const stageAssets = async (run: Run): Promise<void> => {
  const spriteDir = join(packageRoot, 'public', 'sprites');
  await mkdir(spriteDir, { recursive: true });
  for (const pick of run.picks) {
    const source = join(repoRoot, 'data', 'cache', 'sprites', `${pick.dex}.png`);
    if (!(await exists(source))) throw new Error(`Missing sprite for ${pick.name} (dex ${pick.dex}). Run \`pnpm data:sync --only species\` first.`);
    await copyFile(source, join(spriteDir, `${pick.dex}.png`));
  }
  const fontDir = join(packageRoot, 'public', 'fonts');
  await mkdir(fontDir, { recursive: true });
  await copyFile(require.resolve('@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2'), join(fontDir, 'press-start-2p.woff2'));
};

export type RenderOptions = {
  runPath: string;
  manifestPath?: string;
  /** Output file; defaults to out/<run id>.mp4 (or .png for a still). */
  outPath?: string;
  /** Render only these frames, inclusive. */
  frames?: [number, number];
  /** Render a single frame as a PNG instead of a video. */
  still?: number;
  /** 0.5 renders at 540x960, much faster for previews. */
  scale?: number;
  onLog?: (line: string) => void;
};

export const readRun = async (path: string): Promise<Run> => RunSchema.parse(JSON.parse(await readFile(path, 'utf8')));
export const readManifest = async (path: string): Promise<Manifest> => ManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')));

export const renderRun = async (opts: RenderOptions): Promise<{ outPath: string; durationInFrames: number }> => {
  const log = opts.onLog ?? (() => {});
  const run = await readRun(opts.runPath);
  const manifest = opts.manifestPath ? await readManifest(opts.manifestPath) : undefined;

  log('Staging sprites and font…');
  await stageAssets(run);

  log('Bundling…');
  const serveUrl = await bundle({ entryPoint: join(here, 'index.ts'), webpackOverride });

  const browserExecutable = (await findBrowser()) ?? undefined;
  log(`Browser: ${browserExecutable ?? 'Remotion default'}`);
  // Note: do not set chromiumOptions.gl to 'swangle'. It routes the compositor through a software GPU and made
  // every frame about 10x slower (1.4 s vs 0.14 s); this composition is plain DOM and needs no GL.
  const common = { serveUrl, browserExecutable };
  const inputProps = { run, manifest };
  const composition = await selectComposition({ ...common, id: COMPOSITION_ID, inputProps });

  const outDir = join(repoRoot, 'out');
  await mkdir(outDir, { recursive: true });

  if (opts.still !== undefined) {
    const outPath = opts.outPath ?? join(outDir, `${run.id}-frame${opts.still}.png`);
    await renderStill({ ...common, composition, inputProps, frame: opts.still, output: outPath, scale: opts.scale });
    log(`Wrote ${outPath}`);
    return { outPath, durationInFrames: composition.durationInFrames };
  }

  const suffix = opts.frames ? `-${opts.frames[0]}-${opts.frames[1]}` : '';
  const outPath = opts.outPath ?? join(outDir, `${run.id}${suffix}.mp4`);
  let lastPercent = -1;
  await renderMedia({
    ...common,
    composition,
    inputProps,
    codec: 'h264',
    outputLocation: outPath,
    frameRange: opts.frames,
    scale: opts.scale,
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 100);
      if (percent !== lastPercent && percent % 5 === 0) log(`Rendering… ${percent}%`);
      lastPercent = percent;
    },
  });
  log(`Wrote ${outPath}`);
  return { outPath, durationInFrames: composition.durationInFrames };
};
