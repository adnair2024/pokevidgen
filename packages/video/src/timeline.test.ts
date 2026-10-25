import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN, sampleManifest } from './fixtures.js';
import { buildTimeline, nameFrame, normalizeWord, type Timeline } from './timeline.js';
import type { Manifest, Run } from './run.js';
import { DEFAULT_TIMING as T, FPS } from './theme.js';

const seconds = (frames: number) => frames / FPS;

const allFrames = (t: Timeline): number[] => [
  t.hook.start, t.hook.end, t.outro.start, t.outro.end, t.durationInFrames,
  ...t.beats.flatMap((b) => [b.start, b.end, b.cardIn, b.cardOut, b.ballOpen, b.plateIn]),
];

/** Beats run in order, never overlap, and each beat's own events are ordered. */
const expectWellFormed = (t: Timeline) => {
  for (const frame of allFrames(t)) expect(Number.isInteger(frame), `frame ${frame}`).toBe(true);
  expect(t.hook.start).toBeLessThan(t.hook.end);
  let previousEnd = t.hook.end;
  for (const b of t.beats) {
    expect(b.start).toBeGreaterThan(previousEnd); // a gap, not touching
    expect(b.cardIn).toBeGreaterThanOrEqual(b.start);
    expect(b.cardOut).toBeGreaterThan(b.cardIn);
    expect(b.ballOpen).toBeGreaterThan(b.cardOut);
    expect(b.plateIn).toBeGreaterThan(b.ballOpen);
    expect(b.end).toBeGreaterThan(b.plateIn);
    previousEnd = b.end;
  }
  expect(t.outro.start).toBeGreaterThan(previousEnd);
  expect(t.durationInFrames).toBeGreaterThan(t.outro.end);
};

describe('timeline without a voice manifest', () => {
  const t = buildTimeline(SAMPLE_RUN, FPS);

  it('is well formed, in whole frames, with no overlaps', () => expectWellFormed(t));

  it('derives durationInFrames from the beats (about 60-75 seconds for six picks)', () => {
    expect(t.durationInFrames).toBe(t.outro.end + Math.round(T.endHold * FPS));
    expect(seconds(t.durationInFrames)).toBeGreaterThan(60);
    expect(seconds(t.durationInFrames)).toBeLessThan(75);
  });

  it('gives every pick its default beat length, with the 0.25 s gap between them', () => {
    for (const b of t.beats) expect(b.end - b.start).toBe(Math.round(T.beat * FPS));
    expect(t.beats[1]!.start - t.beats[0]!.end).toBe(Math.round(T.gap * FPS));
  });

  it('is a pure function of its inputs', () => {
    expect(buildTimeline(SAMPLE_RUN, FPS)).toEqual(t);
  });

  it('scales with the frame rate and handles fewer picks', () => {
    const one: Run = { ...SAMPLE_RUN, picks: [SAMPLE_RUN.picks[0]!] };
    const t60 = buildTimeline(one, 60);
    expectWellFormed(t60);
    expect(t60.beats).toHaveLength(1);
    expect(t60.durationInFrames).toBeGreaterThan(buildTimeline(one, 30).durationInFrames);
  });
});

describe('timeline with a voice manifest', () => {
  const manifest = sampleManifest();
  const t = buildTimeline(SAMPLE_RUN, FPS, manifest);

  it('is well formed, in whole frames, with no overlaps', () => expectWellFormed(t));

  it('pops the card in at the start of the line and opens the ball on the first frame of the name', () => {
    for (const b of t.beats) {
      expect(b.cardIn).toBe(b.start);
      const pick = SAMPLE_RUN.picks[b.index]!;
      const name = b.voice!.words.find((w) => normalizeWord(w.word) === normalizeWord(pick.name))!;
      // On the name's first frame, but not before the card has had its minimum time on screen.
      const earliest = b.start + Math.round((T.cardIn + T.minCardHold + T.cardOut) * FPS);
      expect(b.ballOpen).toBe(Math.max(name.startFrame, earliest));
      expect(b.plateIn).toBe(b.ballOpen + T.plateDelayFrames);
      expect(b.cardOut).toBe(Math.max(b.start + Math.round((T.cardIn + T.minCardHold) * FPS), b.ballOpen - Math.round(T.exitLead * FPS)));
    }
  });

  it('lasts max(line + 0.6 s hold, minimum visual time)', () => {
    for (const b of t.beats) {
      const narration = b.voice!.endFrame - b.start + Math.round(T.lineHold * FPS);
      expect(b.end - b.start).toBeGreaterThanOrEqual(narration);
      expect(b.end - b.start).toBeGreaterThanOrEqual(Math.round(T.minVisual * FPS));
    }
  });

  it('gives short lines the minimum visual time so the animation is not rushed', () => {
    const short = buildTimeline({ ...SAMPLE_RUN, picks: [SAMPLE_RUN.picks[0]!] }, FPS, {
      lines: [
        ...manifest.lines.filter((l) => l.key === 'hook' || l.key === 'outro'),
        { key: 'nidoqueen', file: 'x.wav', durationMs: 1500, words: [{ word: 'Nidoqueen', startMs: 0, endMs: 700 }, { word: 'wins.', startMs: 700, endMs: 1500 }] },
      ],
    });
    const b = short.beats[0]!;
    expect(seconds(b.end - b.start)).toBeGreaterThanOrEqual(T.minVisual);
    expectWellFormed(short);
  });

  it('never opens the ball before the card has had its minimum time on screen, even if the name comes first', () => {
    const b = buildTimeline({ ...SAMPLE_RUN, picks: [SAMPLE_RUN.picks[0]!] }, FPS, {
      lines: [
        ...manifest.lines.filter((l) => l.key === 'hook' || l.key === 'outro'),
        { key: 'nidoqueen', file: 'x.wav', durationMs: 3000, words: [{ word: 'Nidoqueen', startMs: 0, endMs: 600 }, { word: 'is', startMs: 600, endMs: 900 }, { word: 'great.', startMs: 900, endMs: 3000 }] },
      ],
    }).beats[0]!;
    expect(b.ballOpen - b.cardIn).toBeGreaterThanOrEqual(Math.round((T.cardIn + T.minCardHold + T.cardOut) * FPS));
    expect(b.cardOut).toBeGreaterThan(b.cardIn);
  });

  it('falls back to 55% through the line when the name is not in the word timings', () => {
    const lines: Manifest['lines'] = manifest.lines.map((l) =>
      l.key === 'raichu' ? { ...l, words: l.words.map((w, i) => (i === 0 ? { ...w, word: 'Ray-chew' } : w)) } : l,
    );
    const b = buildTimeline(SAMPLE_RUN, FPS, { lines }).beats[1]!;
    const len = b.voice!.endFrame - b.voice!.startFrame;
    expect(b.ballOpen - b.start).toBe(Math.round(len * T.nameFallback));
  });

  it('puts the hook over the empty grid and the outro after the last beat, then holds', () => {
    expect(t.hook.voice!.key).toBe('hook');
    expect(t.hook.end).toBe(t.hook.voice!.endFrame);
    expect(t.outro.voice!.key).toBe('outro');
    expect(t.durationInFrames).toBe(t.outro.end + Math.round(T.endHold * FPS));
  });

  it('keeps narration at 0.25 s gaps and exposes each line\'s word frames for captions', () => {
    expect(t.beats[0]!.start - t.hook.end).toBe(Math.round(T.gap * FPS));
    const words = t.beats[0]!.voice!.words;
    expect(words[0]!.startFrame).toBe(t.beats[0]!.start);
    for (let i = 1; i < words.length; i++) expect(words[i]!.startFrame).toBeGreaterThanOrEqual(words[i - 1]!.startFrame);
  });
});

describe('nameFrame and normalizeWord', () => {
  it('matches the first word of a multi-word name, ignoring case and punctuation', () => {
    const words = [{ word: 'And', startFrame: 0, endFrame: 5 }, { word: 'MR.', startFrame: 6, endFrame: 12 }, { word: 'Mime', startFrame: 12, endFrame: 20 }];
    expect(nameFrame(words, 0, 30, 'Mr. Mime')).toBe(6);
    expect(normalizeWord('Pokémon!')).toBe('pokemon');
  });
});
