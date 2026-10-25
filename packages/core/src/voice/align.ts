import { normalize } from '../script/lint.js';

export type WhisperWord = { word: string; startMs: number; endMs: number };
export type WordTiming = { word: string; startMs: number; endMs: number };

/** Lowercase tokens of letters and digits; "-A" and "NEE-doh" split into pieces, like Whisper's output does. */
const tokenize = (s: string): string[] => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const editDistance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
};

/** 1 for identical, 0 for nothing alike. */
export const similarity = (a: string, b: string): number => (a === b ? 1 : 1 - editDistance(a, b) / Math.max(a.length, b.length, 1));

type Token = { text: string; owner: number; startMs: number; endMs: number };

/** Whisper words as tokens, splitting hyphenated pieces and sharing the word's time between them by length. */
const whisperTokens = (words: WhisperWord[]): Token[] =>
  words.flatMap((w) => {
    const parts = tokenize(w.word);
    const total = parts.reduce((s, p) => s + p.length, 0) || 1;
    let at = w.startMs;
    return parts.map((text) => {
      const end = at + ((w.endMs - w.startMs) * text.length) / total;
      const t = { text, owner: -1, startMs: at, endMs: end };
      at = end;
      return t;
    });
  });

const MATCH_FLOOR = 0.5;
const GAP = -0.4;
/** At least this share of a word's tokens must have matched for its time to be trusted. */
const MIN_COVERAGE = 0.5;
/** A matched word shorter than this share of its expected length is stretched back into the silence before it. */
const SHORT_FRACTION = 0.25;
const DEFAULT_MS_PER_LETTER = 70;
const MIN_WORD_MS = 40;

/**
 * Match what Whisper heard back onto the words of the script.
 *
 * Whisper's text is never used for captions: it mishears Pokémon names ("Nidekwene" for Nidoqueen). Instead
 * the speech engine's own tokens (the respelled text, which Whisper hears much more like) are aligned to
 * Whisper's by edit distance, and each script word takes the time of the tokens matched to it. Words with
 * no match get their time interpolated between their matched neighbours, in proportion to their length.
 */
export const alignWords = (scriptWords: string[], spoken: string[], heard: WhisperWord[], durationMs: number): WordTiming[] => {
  const ours: Token[] = spoken.flatMap((s, owner) => tokenize(s).map((text) => ({ text, owner, startMs: 0, endMs: 0 })));
  const theirs = whisperTokens(heard);

  // Global alignment (Needleman-Wunsch) over tokens.
  const n = ours.length;
  const m = theirs.length;
  const score = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) score[i]![0] = i * GAP;
  for (let j = 1; j <= m; j++) score[0]![j] = j * GAP;
  const sim = (i: number, j: number) => similarity(ours[i]!.text, theirs[j]!.text);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = sim(i - 1, j - 1);
      score[i]![j] = Math.max(score[i - 1]![j - 1]! + (s >= MATCH_FLOOR ? s : -1), score[i - 1]![j]! + GAP, score[i]![j - 1]! + GAP);
    }
  }
  const matched = new Map<number, Token[]>();
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const s = sim(i - 1, j - 1);
    if (score[i]![j] === score[i - 1]![j - 1]! + (s >= MATCH_FLOOR ? s : -1) && s >= MATCH_FLOOR) {
      const owner = ours[i - 1]!.owner;
      matched.set(owner, [...(matched.get(owner) ?? []), theirs[j - 1]!]);
      i--; j--;
    } else if (score[i]![j] === score[i - 1]![j]! + GAP) i--;
    else if (score[i]![j] === score[i]![j - 1]! + GAP) j--;
    else { i--; j--; }
  }

  // Script words that were matched take the span of their tokens, but only if enough of the word was
  // matched: "Nidoqueen" matched on just its last syllable (to a 40 ms token) says nothing about when it started.
  const tokenCount = new Array<number>(scriptWords.length).fill(0);
  for (const t of ours) tokenCount[t.owner]!++;
  const timed: Array<{ startMs: number; endMs: number } | undefined> = scriptWords.map((_, k) => {
    const hits = matched.get(k);
    if (!hits?.length || hits.length / Math.max(1, tokenCount[k]!) < MIN_COVERAGE) return undefined;
    return { startMs: Math.min(...hits.map((t) => t.startMs)), endMs: Math.max(...hits.map((t) => t.endMs)) };
  });

  // How long a word of this length usually takes, from the solid matches (median ms per letter).
  const letters = (w: string) => Math.max(1, w.replace(/[^A-Za-z0-9]/g, '').length);
  const rates = scriptWords.flatMap((w, k) => (timed[k] && timed[k]!.endMs - timed[k]!.startMs >= 60 ? [(timed[k]!.endMs - timed[k]!.startMs) / letters(w)] : [])).sort((x, y) => x - y);
  const msPerLetter = rates.length ? rates[Math.floor(rates.length / 2)]! : DEFAULT_MS_PER_LETTER;

  // Whisper sometimes reports a word as nearly instant (a zero-length "Earthquake"). Such a word really
  // starts earlier, in the silence before it, so extend it backwards by the time it should have taken.
  for (let k = 0; k < scriptWords.length; k++) {
    const t = timed[k];
    if (!t) continue;
    const expected = letters(scriptWords[k]!) * msPerLetter;
    if (t.endMs - t.startMs < SHORT_FRACTION * expected) {
      const floorMs = k > 0 && timed[k - 1] ? timed[k - 1]!.endMs : 0;
      t.startMs = Math.max(floorMs, t.endMs - expected);
    }
  }

  // The rest are spread between the nearest matched neighbours, in proportion to their length.
  let k = 0;
  while (k < scriptWords.length) {
    if (timed[k]) { k++; continue; }
    let end = k;
    while (end < scriptWords.length && !timed[end]) end++;
    const from = k > 0 ? timed[k - 1]!.endMs : 0;
    const to = end < scriptWords.length ? timed[end]!.startMs : durationMs;
    const span = Math.max(0, to - from);
    const lengths = scriptWords.slice(k, end).map((w) => w.length + 1);
    const total = lengths.reduce((a, b) => a + b, 0);
    let at = from;
    for (let q = k; q < end; q++) {
      const stop = at + (span * lengths[q - k]!) / total;
      timed[q] = { startMs: at, endMs: stop };
      at = stop;
    }
    k = end;
  }

  // No word is left with (almost) no time: borrow a little from a neighbour that can spare it. This is what
  // happens when Whisper merges two words into one ("Hyper Beam" heard as "Hyperbeam").
  for (let q = 0; q < scriptWords.length; q++) {
    const t = timed[q]!;
    if (t.endMs - t.startMs >= MIN_WORD_MS) continue;
    const need = MIN_WORD_MS - (t.endMs - t.startMs);
    const left = timed[q - 1];
    const right = timed[q + 1];
    if (left && left.endMs - left.startMs >= MIN_WORD_MS + need) { left.endMs -= need; t.startMs = left.endMs; }
    else if (right && right.endMs - right.startMs >= MIN_WORD_MS + need) { right.startMs += need; t.endMs = right.startMs; }
  }

  // Keep the result well behaved: in order, inside the audio, never backwards.
  let floor = 0;
  return scriptWords.map((word, q) => {
    const t = timed[q]!;
    const startMs = Math.round(Math.min(Math.max(t.startMs, floor), durationMs));
    const endMs = Math.round(Math.min(Math.max(t.endMs, startMs), durationMs));
    floor = startMs;
    return { word, startMs, endMs };
  });
};

export { normalize };
