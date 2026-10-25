import { exists, repoDir } from '../data/cache.js';
import { createElevenLabsEngine } from './elevenlabs.js';
import type { TtsEngine } from './engine.js';
import { DEFAULT_KOKORO_SPEED, DEFAULT_KOKORO_VOICE, createKokoroEngine } from './kokoro.js';
import { createPiperEngine } from './piper.js';

export const ENGINES = ['kokoro', 'piper', 'elevenlabs'] as const;
export type EngineName = (typeof ENGINES)[number];
export const isEngineName = (s: string): s is EngineName => (ENGINES as readonly string[]).includes(s);

/** Load `.env` from the repository root once, without overriding variables that are already set. */
export const loadEnv = async (): Promise<void> => {
  const path = repoDir('.env');
  if (await exists(path)) process.loadEnvFile(path);
};

/** Voice and speed come from the options, then `KOKORO_VOICE` / `KOKORO_SPEED`, then the defaults. */
export const createEngine = (name: EngineName, opts: { voice?: string; speed?: number } = {}): TtsEngine => {
  const speed = opts.speed ?? (process.env['KOKORO_SPEED'] ? Number(process.env['KOKORO_SPEED']) : DEFAULT_KOKORO_SPEED);
  switch (name) {
    case 'kokoro': return createKokoroEngine({ voice: opts.voice ?? process.env['KOKORO_VOICE'] ?? DEFAULT_KOKORO_VOICE, speed });
    case 'piper': return createPiperEngine({ speed });
    case 'elevenlabs': return createElevenLabsEngine({ voiceId: opts.voice, speed });
  }
};

/**
 * An engine that can name itself and hash lines but cannot synthesize. Used to ask "what would be generated?"
 * without needing an API key, a Piper model, or the Python environment.
 */
export const engineStub = (name: EngineName, opts: { voice?: string; speed?: number } = {}): TtsEngine => ({
  name,
  model: name === 'kokoro' ? 'kokoro-v1.0' : name === 'elevenlabs' ? 'eleven_multilingual_v2' : 'piper',
  voice: opts.voice ?? (name === 'kokoro' ? (process.env['KOKORO_VOICE'] ?? DEFAULT_KOKORO_VOICE) : ''),
  speed: opts.speed ?? (process.env['KOKORO_SPEED'] ? Number(process.env['KOKORO_SPEED']) : DEFAULT_KOKORO_SPEED),
  extension: name === 'elevenlabs' ? 'mp3' : 'wav',
  synthesize: async () => { throw new Error(`The ${name} engine is only a stub here and cannot synthesize.`); },
  describeCost: name === 'elevenlabs'
    ? (characters) => `${characters} characters will be billed by ElevenLabs. Free-plan audio is non-commercial and needs attribution.`
    : undefined,
});
