import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { cacheDir, exists, repoDir } from '../data/cache.js';

const voiceDir = repoDir('tools', 'voice');
export const MODEL_DIR = join(voiceDir, 'models');

/** Run `tools/voice/<script>` with one JSON request on stdin and read one JSON response from stdout. */
export const callSidecar = async <T>(script: string, request: unknown): Promise<T> => {
  const venvPython = join(voiceDir, '.venv', 'bin', 'python');
  const [command, args] = (await exists(venvPython))
    ? [venvPython, [script]]
    : ['uv', ['run', '--project', voiceDir, 'python', script]];
  return new Promise<T>((resolve, reject) => {
    const child = spawn(command, args, { cwd: voiceDir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(new Error(`Could not start the voice sidecar (${command}): ${e.message}. Run \`pnpm voice setup\`.`)));
    child.on('close', (code) => {
      const last = out.trim().split('\n').filter(Boolean).at(-1);
      let parsed: { error?: string } | undefined;
      try { parsed = last ? (JSON.parse(last) as { error?: string }) : undefined; } catch { /* handled below */ }
      if (code === 0 && parsed && !parsed.error) return resolve(parsed as T);
      reject(new Error(parsed?.error ?? `The voice sidecar ${script} exited with code ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
    child.stdin.end(JSON.stringify(request));
  });
};

/** True once `pnpm voice setup` has created the Python environment and downloaded the models. */
export const voiceReady = async (): Promise<{ ready: boolean; missing: string[] }> => {
  const needed = {
    'Python environment (tools/voice/.venv)': join(voiceDir, '.venv', 'bin', 'python'),
    'Kokoro model': join(MODEL_DIR, 'kokoro', 'kokoro-v1.0.onnx'),
    'Kokoro voices': join(MODEL_DIR, 'kokoro', 'voices-v1.0.bin'),
  };
  const missing: string[] = [];
  for (const [label, path] of Object.entries(needed)) if (!(await exists(path))) missing.push(label);
  return { ready: missing.length === 0, missing };
};

export const voiceCacheDir = (...parts: string[]): string => cacheDir('voice', ...parts);
