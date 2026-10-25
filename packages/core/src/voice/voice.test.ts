import { describe, expect, it } from 'vitest';
import { alignWords, similarity, type WhisperWord } from './align.js';
import { spokenForm, toSpoken } from './pronounce.js';

const RESPELL = { nidoqueen: 'NEE-doh-kween', agatha: 'AG-uh-thuh', haunter: 'HAWN-ter', 'lt.': 'loo-TEN-int', surge: 'SURJ', misty: 'MIS-tee', tm: 'T M', f: 'female' };

/** Real faster-whisper output for the same sentence spoken by Kokoro, raw and respelled (captured on this machine). */
const RAW_TEXT = 'Nidoqueen is how we deal with Agatha. Earthquake wipes out Haunter in a single hit.';
const HEARD_RAW: WhisperWord[] = [
  ['Nidekwene', 0, 500], ['is', 500, 660], ['how', 660, 860], ['we', 860, 1000], ['deal', 1000, 1140], ['with', 1140, 1340], ['Agatha.', 1340, 1720],
  ['Earthquake', 2360, 2540], ['wipes', 2540, 2980], ['out', 2980, 3220], ['Haunter', 3220, 3600], ['in', 3600, 3800], ['a', 3800, 3860], ['single', 3860, 4040], ['hit.', 4040, 4380],
].map(([word, startMs, endMs]) => ({ word: word as string, startMs: startMs as number, endMs: endMs as number }));
const HEARD_RESPELLED: WhisperWord[] = [
  ['NEE', 0, 340], ['Dokween', 340, 840], ['is', 840, 1240], ['how', 1240, 1420], ['we', 1420, 1560], ['deal', 1560, 1700], ['with', 1700, 1900], ['AG', 1900, 2260], ['-A', 2260, 2500], ['-tha.', 2500, 2800],
  ['Earthquake', 3300, 3500], ['wipes', 3500, 3900], ['out', 3900, 4160], ['Haunter', 4160, 4560], ['in', 4560, 4820], ['a', 4820, 4900], ['single', 4900, 5080], ['hit.', 5080, 5420],
].map(([word, startMs, endMs]) => ({ word: word as string, startMs: startMs as number, endMs: endMs as number }));

const expectOrdered = (words: Array<{ startMs: number; endMs: number }>, durationMs: number) => {
  for (const [i, w] of words.entries()) {
    expect(w.endMs, `word ${i}`).toBeGreaterThanOrEqual(w.startMs);
    expect(w.startMs).toBeGreaterThanOrEqual(0);
    expect(w.endMs).toBeLessThanOrEqual(durationMs);
    if (i > 0) expect(w.startMs, `word ${i}`).toBeGreaterThanOrEqual(words[i - 1]!.startMs);
  }
};

describe('pronunciation', () => {
  it('respells names and keeps punctuation and possessives', () => {
    expect(spokenForm('Nidoqueen,', RESPELL)).toBe('Nee-doh-kween,');
    expect(spokenForm('(Agatha)', RESPELL)).toBe('(Ag-uh-thuh)');
    expect(spokenForm("Misty's", RESPELL)).toBe("Mis-tee's");
    expect(spokenForm('unknownword.', RESPELL)).toBe('unknownword.');
  });

  it('does not double the full stop in abbreviations such as "Lt."', () => {
    expect(spokenForm('Lt.', RESPELL)).toBe('Loo-ten-int');
    expect(toSpoken('For Lt. Surge, we need an answer.', RESPELL).text).toBe('For Loo-ten-int Surj, we need an answer.');
  });

  it('reads letter-digit codes letter by letter, never as dictionary words', () => {
    expect(spokenForm('TM15.', RESPELL)).toBe('T M 15.');
    expect(spokenForm('HM3', RESPELL)).toBe('H M 3');
    expect(spokenForm('B1F', RESPELL)).toBe('B 1 F'); // the F is not "female"
  });

  it('writes respellings in lower case for the engine (all-caps chunks are spelled out as acronyms), capitalizing names', () => {
    expect(spokenForm('Gyarados', { gyarados: 'GY-uh-rah-dose' })).toBe('Gy-uh-rah-dose');
    expect(spokenForm('use', { use: 'YOOZ' })).toBe('yooz');
  });

  it('applies to the speech text only: captions keep the script\'s own words', () => {
    const line = toSpoken('Nidoqueen is how we deal with Agatha.', RESPELL);
    expect(line.words).toEqual(['Nidoqueen', 'is', 'how', 'we', 'deal', 'with', 'Agatha.']);
    expect(line.text).toBe('Nee-doh-kween is how we deal with Ag-uh-thuh.');
  });

  it('treats an empty respelling as "checked, speak it as written"', () => {
    expect(spokenForm('Squirtle,', { squirtle: '' })).toBe('Squirtle,');
    expect(toSpoken('Squirtle wins.', { squirtle: '' }).text).toBe('Squirtle wins.');
  });

  it('with respelling off, only digit codes are expanded', () => {
    expect(toSpoken('Nidoqueen learns Dig from TM28.', RESPELL, false).text).toBe('Nidoqueen learns Dig from T M 28.');
  });
});

/** Real Whisper output (faster-whisper base.en) for a Kokoro line whose respelling was spelled out, so it is full of errors. */
const REAL_TEXT = 'For Agatha, we need an answer, and Nidoqueen is it. Earthquake wipes out Haunter in a single hit. Hyper Beam comes from TM15.';
const REAL_HEARD: WhisperWord[] = ([
  ['For', 0, 120], ['A.', 120, 280], ['G.', 320, 520], ['A.', 640, 660], ['We', 840, 1240], ['need', 1240, 1420], ['an', 1420, 1520], ['answer,', 1520, 1800], ['and', 2260, 2280],
  ['any', 2280, 2480], ['E', 2480, 2720], ['.D', 2720, 2860], ['.O.', 2860, 2960], ['queen', 3140, 3180], ['is', 3180, 3360], ['it.', 3360, 3520], ['Earthquake', 4300, 4300],
  ['wipes', 4300, 4660], ['out', 4660, 4940], ['Haunter', 4940, 5340], ['in', 5340, 5580], ['a', 5580, 5660], ['single', 5660, 5820], ['hit.', 5820, 6160],
  ['Hyperbeam', 7020, 7220], ['comes', 7220, 7560], ['from', 7560, 7840], ['TM', 7840, 8040], ['-15.', 8040, 8680],
] as Array<[string, number, number]>).map(([word, startMs, endMs]) => ({ word, startMs, endMs }));

describe('alignWords on real, badly misheard output', () => {
  const line = toSpoken(REAL_TEXT, RESPELL, true);
  const timings = alignWords(line.words, line.spoken, REAL_HEARD, 9020);
  const at = (w: string) => timings.find((t) => t.word.startsWith(w))!;

  it('does not trust a word matched on one syllable: "Nidoqueen" starts where the silence before it ends, not at its last syllable', () => {
    expect(at('Nidoqueen').startMs).toBeGreaterThanOrEqual(2260); // after "and"
    expect(at('Nidoqueen').startMs).toBeLessThan(2700); // the ball opens on this frame, so 800 ms late is a visible bug
    expect(at('Nidoqueen').endMs).toBeLessThanOrEqual(at('is').startMs);
  });

  it('gives a word Whisper reported as instant its real length by extending it into the silence before it', () => {
    const eq = at('Earthquake');
    expect(eq.endMs - eq.startMs).toBeGreaterThanOrEqual(300);
    expect(eq.startMs).toBeGreaterThanOrEqual(at('it.').endMs);
  });

  it('never leaves a word with no time, even when Whisper merged two words ("Hyper Beam" → "Hyperbeam")', () => {
    for (const t of timings) expect(t.endMs - t.startMs, t.word).toBeGreaterThanOrEqual(40);
    expect(at('Beam').startMs).toBeGreaterThanOrEqual(at('Hyper').startMs);
  });

  it('keeps every script word, in order, inside the audio', () => {
    expect(timings.map((t) => t.word)).toEqual(line.words);
    expectOrdered(timings, 9020);
  });
});

describe('similarity', () => {
  it('is 1 for equal words and falls with edit distance', () => {
    expect(similarity('agatha', 'agatha')).toBe(1);
    expect(similarity('kween', 'dokween')).toBeGreaterThan(0.5);
    expect(similarity('hit', 'zebra')).toBeLessThan(0.5);
  });
});

describe('alignWords', () => {
  it('maps a misheard name back onto the script word, and never uses Whisper\'s text', () => {
    const line = toSpoken(RAW_TEXT, RESPELL, false);
    const timings = alignWords(line.words, line.spoken, HEARD_RAW, 4400);
    expect(timings.map((t) => t.word)).toEqual(line.words);
    expect(timings.map((t) => t.word)).not.toContain('Nidekwene');
    expect(timings[0]).toMatchObject({ word: 'Nidoqueen', startMs: 0 });
    expect(timings[0]!.endMs).toBeLessThanOrEqual(500);
    expect(timings[6]).toMatchObject({ word: 'Agatha.', startMs: 1340, endMs: 1720 });
    expectOrdered(timings, 4400);
  });

  it('matches against the respelled text but reports the original words (respelled line)', () => {
    const line = toSpoken(RAW_TEXT, RESPELL, true);
    expect(line.text).toContain('Nee-doh-kween');
    const timings = alignWords(line.words, line.spoken, HEARD_RESPELLED, 5450);
    expect(timings.map((t) => t.word)).toEqual(['Nidoqueen', 'is', 'how', 'we', 'deal', 'with', 'Agatha.', 'Earthquake', 'wipes', 'out', 'Haunter', 'in', 'a', 'single', 'hit.']);
    expect(timings[0]!.startMs).toBe(0);
    expect(timings[0]!.endMs).toBeGreaterThan(340); // covers "NEE" and "Dokween"
    expect(timings[6]).toMatchObject({ startMs: 1900 }); // "Agatha." starts at "AG"
    expect(timings[6]!.endMs).toBe(2800);
    expect(timings[7]!.startMs).toBe(3300);
    expectOrdered(timings, 5450);
  });

  it('interpolates words Whisper dropped, in proportion to their length, between their neighbours', () => {
    const line = toSpoken(RAW_TEXT, RESPELL, false);
    const dropped = HEARD_RAW.filter((w) => !['how', 'we'].includes(w.word));
    const timings = alignWords(line.words, line.spoken, dropped, 4400);
    expect(timings.map((t) => t.word)).toEqual(line.words);
    const [is, how, we, deal] = [timings[1]!, timings[2]!, timings[3]!, timings[4]!];
    expect(how.startMs).toBeGreaterThanOrEqual(is.endMs);
    expect(we.endMs).toBeLessThanOrEqual(deal.startMs);
    expect(how.endMs - how.startMs).toBeGreaterThan(0);
    expect(we.endMs - we.startMs).toBeGreaterThan(0);
    expectOrdered(timings, 4400);
  });

  it('spreads every word across the audio when Whisper heard nothing', () => {
    const line = toSpoken('One two three four.', {}, false);
    const timings = alignWords(line.words, line.spoken, [], 2000);
    expect(timings).toHaveLength(4);
    expect(timings[0]!.startMs).toBe(0);
    expect(timings[3]!.endMs).toBe(2000);
    expectOrdered(timings, 2000);
  });

  it('survives complete nonsense from Whisper without crashing or going out of order', () => {
    const line = toSpoken(RAW_TEXT, RESPELL, true);
    const junk: WhisperWord[] = [{ word: 'zzz', startMs: 100, endMs: 400 }, { word: 'qqq', startMs: 400, endMs: 900 }];
    const timings = alignWords(line.words, line.spoken, junk, 4000);
    expect(timings).toHaveLength(line.words.length);
    expectOrdered(timings, 4000);
  });

  it('copes with extra words Whisper invented', () => {
    const line = toSpoken('Raichu wins.', {}, false);
    const heard: WhisperWord[] = [{ word: 'Uh', startMs: 0, endMs: 100 }, { word: 'Raichu', startMs: 100, endMs: 600 }, { word: 'totally', startMs: 600, endMs: 900 }, { word: 'wins.', startMs: 900, endMs: 1300 }];
    const timings = alignWords(line.words, line.spoken, heard, 1300);
    expect(timings).toEqual([{ word: 'Raichu', startMs: 100, endMs: 600 }, { word: 'wins.', startMs: 900, endMs: 1300 }]);
  });

  it('handles an expanded code (TM15 → T M 15) by taking the span of its pieces', () => {
    const line = toSpoken('It comes from TM15.', {}, false);
    const heard: WhisperWord[] = [
      { word: 'It', startMs: 0, endMs: 100 }, { word: 'comes', startMs: 100, endMs: 400 }, { word: 'from', startMs: 400, endMs: 600 },
      { word: 'T', startMs: 600, endMs: 700 }, { word: 'M', startMs: 700, endMs: 800 }, { word: '15.', startMs: 800, endMs: 1300 },
    ];
    const timings = alignWords(line.words, line.spoken, heard, 1300);
    expect(timings[3]).toEqual({ word: 'TM15.', startMs: 600, endMs: 1300 });
  });
});
