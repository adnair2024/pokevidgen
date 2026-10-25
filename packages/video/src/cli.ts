import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { renderRun, repoRoot } from './render.js';

const [command, ...rest] = process.argv.slice(2);

if (command !== 'render') {
  console.error('Usage: pnpm video render <runs/id.json> [--manifest file] [--out file] [--frames 0-300] [--still 120] [--scale 0.5]');
  process.exit(command ? 1 : 0);
}

const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    manifest: { type: 'string' }, out: { type: 'string' }, frames: { type: 'string' }, still: { type: 'string' }, scale: { type: 'string' },
  },
});

const runArg = positionals[0];
if (!runArg) {
  console.error('Give the run file to render, e.g. runs/red-s1.json');
  process.exit(1);
}
// pnpm runs this from packages/video, so paths are taken relative to the repo root.
const abs = (p: string) => (isAbsolute(p) ? p : resolve(repoRoot, p));

let frames: [number, number] | undefined;
if (values.frames) {
  const m = /^(\d+)-(\d+)$/.exec(values.frames);
  if (!m) {
    console.error('--frames must look like 0-300');
    process.exit(1);
  }
  frames = [Number(m[1]), Number(m[2])];
}

try {
  const result = await renderRun({
    runPath: abs(runArg),
    manifestPath: values.manifest ? abs(values.manifest) : undefined,
    outPath: values.out ? abs(values.out) : undefined,
    frames,
    still: values.still !== undefined ? Number(values.still) : undefined,
    scale: values.scale !== undefined ? Number(values.scale) : undefined,
    onLog: (line) => console.log(line),
  });
  console.log(`done: ${result.outPath} (${result.durationInFrames} frames)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
