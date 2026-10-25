import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { SynthRequest, SynthResult, TtsEngine } from './engine.js';
import { wavDurationMs } from './wav.js';

/**
 * Piper: the fastest draft voice. Needs the `piper` binary on PATH and a voice model (`PIPER_MODEL`, a
 * path to an .onnx file). Untested against a real Piper install; the process handling is covered by tests.
 */
export const createPiperEngine = (opts: { model?: string; speed?: number; command?: string } = {}): TtsEngine => {
  const model = opts.model ?? process.env['PIPER_MODEL'];
  if (!model) throw new Error('Piper needs a voice model: set PIPER_MODEL to the path of an .onnx voice.');
  const speed = opts.speed ?? 1.1;
  const command = opts.command ?? 'piper';
  return {
    name: 'piper',
    model: 'piper',
    voice: model,
    speed,
    extension: 'wav',
    async synthesize(requests: SynthRequest[]): Promise<SynthResult[]> {
      const out: SynthResult[] = [];
      for (const r of requests) {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(command, ['--model', model, '--output_file', r.outPath, '--length_scale', String(1 / speed)]);
          let err = '';
          child.stderr.on('data', (d: Buffer) => (err += d.toString()));
          child.on('error', (e) => reject(new Error(`Could not run piper: ${e.message}`)));
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper exited with code ${code}: ${err.trim().slice(-200)}`))));
          child.stdin.end(r.text + '\n');
        });
        out.push({ key: r.key, audioPath: r.outPath, durationMs: wavDurationMs(await readFile(r.outPath)) });
      }
      return out;
    },
  };
};
