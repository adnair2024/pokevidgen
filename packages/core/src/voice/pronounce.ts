/**
 * Respellings apply to the text sent to the speech engine only. Captions always show the script's own
 * words, so every script word keeps its original text and gets a separate "spoken form".
 */

const spell = (letters: string): string => [...letters.toUpperCase()].join(' ');

/**
 * Codes that mix letters and digits (TM15, HM3, B1F) are read letter by letter: "T M 15", "B 1 F". They
 * are never looked up as words, so a letter like F can't turn into "female".
 */
const CODE = /^([A-Za-z]+)(\d+)([A-Za-z]*)$/;

/** Split a whitespace-delimited word into leading punctuation, the core, and trailing punctuation. */
const peel = (word: string): { lead: string; core: string; trail: string } => {
  const m = /^([^A-Za-z0-9À-ɏ]*)(.*?)([^A-Za-z0-9À-ɏ]*)$/su.exec(word)!;
  return { lead: m[1]!, core: m[2]!, trail: m[3]! };
};

/**
 * Respellings are written with the stress in capitals ("AG-uh-thuh"), which is how people read them, but
 * Kokoro spells out short all-caps chunks as acronyms ("A. G. A."), so the engine gets them in lower case.
 * The first letter follows the script word, so a name stays a name.
 */
export const asSpeech = (respelling: string, original: string): string => {
  const lower = respelling.toLowerCase();
  return /^[A-Z]/.test(original) ? lower[0]!.toUpperCase() + lower.slice(1) : lower;
};

/** What the speech engine is given for one script word. */
export const spokenForm = (word: string, respellings: Readonly<Record<string, string>>): string => {
  const { lead, core, trail } = peel(word);
  if (!core) return word;
  const code = CODE.exec(core);
  if (code) return `${lead}${[spell(code[1]!), code[2]!, code[3] ? spell(code[3]) : ''].filter(Boolean).join(' ')}${trail}`;
  // Possessives: "Misty's" → respell "misty", keep "'s".
  const [stem, ...rest] = core.split("'");
  const key = (stem ?? core).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const withDot = respellings[`${key}.`] !== undefined && trail.startsWith('.') ? respellings[`${key}.`] : undefined;
  const hit = withDot ?? respellings[key];
  // No entry: unknown word. An empty entry: checked, and the plain spelling is spoken correctly.
  if (hit === undefined || hit === '') return word;
  // "Lt." has the full stop inside its key, so it must not be doubled onto the trailing punctuation.
  const trailing = withDot !== undefined ? trail.slice(1) : trail;
  return `${lead}${asSpeech(hit, core)}${rest.length ? `'${rest.join("'")}` : ''}${trailing}`;
};

export type SpokenLine = { words: string[]; spoken: string[]; text: string };

/** Split a line into script words and the text actually sent to the engine. */
export const toSpoken = (text: string, respellings: Readonly<Record<string, string>>, respell = true): SpokenLine => {
  const words = text.split(/\s+/).filter(Boolean);
  const spoken = words.map((w) => (respell ? spokenForm(w, respellings) : spokenFormPlain(w)));
  return { words, spoken, text: spoken.join(' ') };
};

/** Without respellings only the digit codes are expanded (they would be read badly otherwise). */
const spokenFormPlain = (word: string): string => spokenForm(word, {});
