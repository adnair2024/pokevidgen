import { describe, expect, it } from 'vitest';
import { dbToGain, duckVolume } from './audio.js';
import { backgroundKeyframes } from './background.js';
import { captionAt, chunkWords, estimateWords } from './captions.js';
import { SAMPLE_RUN } from './fixtures.js';
import { CARD_COLORS, NEUTRAL_BACKGROUND, TYPE_COLORS, shade, typeBackground } from './theme.js';
import { buildTimeline } from './timeline.js';

describe('captions', () => {
  const text = 'For Agatha, we need an answer, and Nidoqueen is it.';

  it('estimates word timings that cover the window exactly and never go backwards', () => {
    const words = estimateWords(text, 100, 400);
    expect(words.map((w) => w.word).join(' ')).toBe(text);
    expect(words[0]!.startFrame).toBe(100);
    expect(words[words.length - 1]!.endFrame).toBe(400);
    for (let i = 1; i < words.length; i++) expect(words[i]!.startFrame).toBe(words[i - 1]!.endFrame);
  });

  it('shows 2-4 words at a time, never a lone word', () => {
    for (let n = 2; n <= 25; n++) {
      const words = estimateWords(Array.from({ length: n }, (_, i) => `w${i}`).join(' '), 0, n * 10);
      const chunks = chunkWords(words);
      expect(chunks.flat()).toHaveLength(n);
      for (const c of chunks) {
        expect(c.length).toBeGreaterThanOrEqual(2);
        expect(c.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('highlights the word being spoken, keeps the last one lit between words, and shows nothing outside the line', () => {
    const words = [
      { word: 'one', startFrame: 10, endFrame: 20 }, { word: 'two', startFrame: 25, endFrame: 35 }, { word: 'three', startFrame: 35, endFrame: 50 },
    ];
    expect(captionAt(words, 5)).toBeUndefined();
    expect(captionAt(words, 60)).toBeUndefined();
    expect(captionAt(words, 12)!.chunk[captionAt(words, 12)!.active]!.word).toBe('one');
    expect(captionAt(words, 22)!.chunk[captionAt(words, 22)!.active]!.word).toBe('one'); // in the gap
    expect(captionAt(words, 40)!.chunk[captionAt(words, 40)!.active]!.word).toBe('three');
  });
});

describe('music ducking', () => {
  const windows = [{ startFrame: 100, endFrame: 200 }];

  it('is −12 dB (about 0.25) during narration and 1 well outside it', () => {
    expect(dbToGain(-12)).toBeCloseTo(0.251, 3);
    expect(duckVolume(150, 30, windows)).toBeCloseTo(dbToGain(-12), 5);
    expect(duckVolume(0, 30, windows)).toBe(1);
    expect(duckVolume(400, 30, windows)).toBe(1);
  });

  it('ramps over 150 ms (about 5 frames at 30 fps) into and out of the duck', () => {
    expect(duckVolume(95, 30, windows)).toBeCloseTo(1, 5);
    const mid = duckVolume(98, 30, windows);
    expect(mid).toBeGreaterThan(dbToGain(-12));
    expect(mid).toBeLessThan(1);
    expect(duckVolume(100, 30, windows)).toBeCloseTo(dbToGain(-12), 5);
    expect(duckVolume(205, 30, windows)).toBeCloseTo(1, 5);
  });

  it('never goes below the duck level when lines are close together', () => {
    const two = [{ startFrame: 100, endFrame: 200 }, { startFrame: 203, endFrame: 300 }];
    for (let f = 90; f < 310; f++) expect(duckVolume(f, 30, two)).toBeGreaterThanOrEqual(dbToGain(-12) - 1e-9);
  });
});

describe('background', () => {
  const timeline = buildTimeline(SAMPLE_RUN, 30);
  const { frames, colors } = backgroundKeyframes(timeline, SAMPLE_RUN);

  it('has strictly increasing frames (what interpolateColors needs), one colour per frame', () => {
    expect(colors).toHaveLength(frames.length);
    for (let i = 1; i < frames.length; i++) expect(frames[i]!).toBeGreaterThan(frames[i - 1]!);
  });

  it('starts and ends neutral and visits each pick\'s type colour in order', () => {
    expect(colors[0]).toBe(NEUTRAL_BACKGROUND);
    expect(colors[colors.length - 1]).toBe(NEUTRAL_BACKGROUND);
    const visited = SAMPLE_RUN.picks.map((p) => typeBackground(p.types[0]));
    let from = 0;
    for (const c of visited) {
      const at = colors.indexOf(c, from);
      expect(at).toBeGreaterThanOrEqual(from);
      from = at;
    }
  });
});

describe('theme', () => {
  it('has a colour for every gen 1 type', () => {
    for (const t of ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon']) {
      expect(TYPE_COLORS[t], t).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('darkens colours for backgrounds and falls back to neutral for unknown types', () => {
    expect(shade('#FFFFFF', 0.5)).toBe('#808080');
    expect(typeBackground('fire')).not.toBe(TYPE_COLORS['fire']);
    expect(typeBackground('nope')).toBe(NEUTRAL_BACKGROUND);
    expect(typeBackground(undefined)).toBe(NEUTRAL_BACKGROUND);
  });

  it('uses red for the Pokédex, gold for gym leaders and green for TMs', () => {
    expect(CARD_COLORS.pokedex.header).toMatch(/^#d/i);
    expect(CARD_COLORS.gymLeader.header).toMatch(/^#f/i);
    expect(CARD_COLORS.tm.header).toMatch(/^#3/i);
  });
});
