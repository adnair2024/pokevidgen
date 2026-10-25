import type { WhisperWord } from './align.js';

export type SynthRequest = {
  key: string;
  /** The text sent to the engine, after pronunciation respellings. */
  text: string;
  /** Where to write the audio; the extension comes from the engine. */
  outPath: string;
};

export type SynthResult = {
  key: string;
  audioPath: string;
  durationMs: number;
  /** For engines that report their own word timings (so Whisper isn't needed). */
  heard?: WhisperWord[];
};

/** A speech engine. Batched, because starting the model is the slow part. */
export interface TtsEngine {
  readonly name: string;
  readonly model: string;
  readonly voice: string;
  readonly speed: number;
  readonly extension: 'wav' | 'mp3';
  synthesize(requests: SynthRequest[]): Promise<SynthResult[]>;
  /** A human-readable note about what generating this text would cost. */
  describeCost?(characters: number): string;
}

/** Turns audio files into Whisper-style word timings (faster-whisper). Separate from the engine so tests can fake it. */
export interface WordAligner {
  align(files: Array<{ key: string; path: string }>): Promise<Array<{ key: string; words: WhisperWord[] }>>;
}
