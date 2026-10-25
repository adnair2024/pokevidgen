import { DEFAULT_TIMING as T } from './theme.js';
import type { Manifest, Run } from './run.js';

export type WordFrames = { word: string; startFrame: number; endFrame: number };

export type VoiceLine = { key: string; file: string; startFrame: number; endFrame: number; words: WordFrames[] };

export type Beat = {
  index: number;
  /** First frame of this pick's beat. */
  start: number;
  end: number;
  /** Card pops in. */
  cardIn: number;
  /** Card starts leaving. */
  cardOut: number;
  /** The Pokéball opens on this frame; effects start on the same frame. */
  ballOpen: number;
  /** The name and type plate appears. */
  plateIn: number;
  /** Narration, when there is a voice manifest. */
  voice?: VoiceLine;
};

export type Timeline = {
  fps: number;
  hook: { start: number; end: number; voice?: VoiceLine };
  beats: Beat[];
  outro: { start: number; end: number; voice?: VoiceLine };
  durationInFrames: number;
};

/** Lowercase letters and digits only, so "Mr." and "mr" compare equal. */
export const normalizeWord = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Seconds to whole frames. Every frame value in the timeline goes through here exactly once. */
const f = (seconds: number, fps: number): number => Math.round(seconds * fps);

const toVoice = (key: string, file: string, startFrame: number, durationMs: number, words: Manifest['lines'][number]['words'], fps: number): VoiceLine => ({
  key,
  file,
  startFrame,
  endFrame: startFrame + f(durationMs / 1000, fps),
  words: words.map((w) => ({ word: w.word, startFrame: startFrame + f(w.startMs / 1000, fps), endFrame: startFrame + f(w.endMs / 1000, fps) })),
});

/**
 * Where the Pokémon's name is spoken, in frames from the start of the line. Falls back to 55% through
 * the line when the name isn't in the word timings (Whisper often mishears Pokémon names).
 */
export const nameFrame = (words: WordFrames[], lineStart: number, lineEnd: number, pokemonName: string): number => {
  const first = normalizeWord(pokemonName.split(/\s+/)[0] ?? pokemonName);
  const hit = first ? words.find((w) => normalizeWord(w.word) === first) : undefined;
  return hit ? hit.startFrame - lineStart : Math.round((lineEnd - lineStart) * T.nameFallback);
};

/**
 * Pure: (run, fps, voice manifest?) → beats, in whole frames. Without a manifest every beat has its
 * default length. With one, narration drives the timing: the card pops in at the line's start, leaves
 * just before the name, and the ball opens on the name's first frame.
 *
 *   [hook line .....][gap]
 *   [pick 1: line ..........][hold][gap]
 *   ...
 *   [outro line .....][end hold]
 */
export const buildTimeline = (run: Run, fps: number, manifest?: Manifest): Timeline => {
  const gap = f(T.gap, fps);
  const line = (key: string) => manifest?.lines.find((l) => l.key === key);

  const hookLine = line('hook');
  const hookStart = 0;
  const hookVoice = hookLine ? toVoice('hook', hookLine.file, hookStart, hookLine.durationMs, hookLine.words, fps) : undefined;
  const hookEnd = hookVoice ? hookVoice.endFrame : f(T.hook, fps);

  const cardInDur = f(T.cardIn, fps);
  const cardOutDur = f(T.cardOut, fps);
  const minCardHold = f(T.minCardHold, fps);
  const ballDur = f(T.ballOpen, fps);
  const plateHold = f(T.plateHold, fps);

  let cursor = hookEnd + gap;
  const beats: Beat[] = [];
  for (const [index, pick] of run.picks.entries()) {
    const start = cursor;
    const spoken = line(pick.pokemon);
    const voice = spoken ? toVoice(pick.pokemon, spoken.file, start, spoken.durationMs, spoken.words, fps) : undefined;

    let cardIn: number, cardOut: number, ballOpen: number, plateIn: number, length: number;
    if (voice) {
      cardIn = start;
      // The earliest the ball can open: card in, a minimum hold, and the card's exit.
      const earliest = start + cardInDur + minCardHold + cardOutDur;
      ballOpen = Math.max(earliest, start + nameFrame(voice.words, voice.startFrame, voice.endFrame, pick.name));
      cardOut = Math.max(start + cardInDur + minCardHold, ballOpen - f(T.exitLead, fps));
      plateIn = ballOpen + T.plateDelayFrames;
      const narration = voice.endFrame - start + f(T.lineHold, fps);
      const visual = Math.max(f(T.minVisual, fps), plateIn + plateHold - start, ballOpen + ballDur - start);
      length = Math.max(narration, visual);
    } else {
      cardIn = start + f(T.idle, fps);
      cardOut = cardIn + cardInDur + f(T.cardHold, fps);
      ballOpen = cardOut + cardOutDur + Math.round(f(T.bgShift, fps) / 2);
      plateIn = ballOpen + T.plateDelayFrames;
      length = f(T.beat, fps);
    }
    beats.push({ index, start, end: start + length, cardIn, cardOut, ballOpen, plateIn, voice });
    cursor = start + length + gap;
  }

  const outroLine = line('outro');
  const outroStart = cursor;
  const outroVoice = outroLine ? toVoice('outro', outroLine.file, outroStart, outroLine.durationMs, outroLine.words, fps) : undefined;
  const outroEnd = outroVoice ? outroVoice.endFrame : outroStart + f(T.outro, fps);

  return {
    fps,
    hook: { start: hookStart, end: hookEnd, voice: hookVoice },
    beats,
    outro: { start: outroStart, end: outroEnd, voice: outroVoice },
    durationInFrames: outroEnd + f(T.endHold, fps),
  };
};
