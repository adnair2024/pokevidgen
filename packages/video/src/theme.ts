/** Every colour and default timing lives here; components never hardcode them. */

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;

/** Layout in pixels. Everything stays at least 64px inside the right and bottom edges so the TikTok UI doesn't cover it. */
export const LAYOUT = {
  margin: 80,
  titleTop: 84,
  gridTop: 220,
  slotW: 440,
  slotH: 420,
  gap: 40,
  /** Captions sit above the bottom safe zone. */
  captionsTop: 1596,
  captionsBottom: 1776,
  /** Whole-number scale for sprites, so pixels stay square. */
  spriteScale: 5,
  spriteSize: 56,
} as const;

export const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A878', fire: '#F08030', water: '#6890F0', electric: '#F8D030', grass: '#78C850', ice: '#98D8D8',
  fighting: '#C03028', poison: '#A040A0', ground: '#E0C068', flying: '#A890F0', psychic: '#F85888', bug: '#A8B820',
  rock: '#B8A038', ghost: '#705898', dragon: '#7038F8', dark: '#705848', steel: '#B8B8D0', fairy: '#EE99AC',
};

export const NEUTRAL_BACKGROUND = '#1b1d33';

export const CARD_COLORS = {
  pokedex: { header: '#d8332a', border: '#7d1510', label: 'POKÉDEX' },
  gymLeader: { header: '#f2b01e', border: '#8a5a00', label: 'GYM LEADER' },
  tm: { header: '#3aa655', border: '#17612d', label: 'TM' },
} as const;

export const TEXT = { light: '#ffffff', dark: '#1a1a2e', muted: '#5b5f77', caption: '#ffffff', captionHighlight: '#ffd23f' } as const;

/** Default beat lengths in seconds, used when there is no voice manifest. */
export const DEFAULT_TIMING = {
  hook: 3.5,
  outro: 3.5,
  endHold: 1,
  /** Pause between narration lines. */
  gap: 0.25,
  /** Whole pick beat. */
  beat: 9.5,
  idle: 0.4,
  cardIn: 0.5,
  cardHold: 3,
  cardOut: 0.3,
  ballOpen: 0.7,
  /** Frames after the ball opens before the name plate appears. */
  plateDelayFrames: 6,
  /** Pokémon stays on screen at least this long after the plate appears. */
  plateHold: 1.2,
  /** Narration drives timing: beat = max(line + this hold, minVisual). */
  lineHold: 0.6,
  minVisual: 3.5,
  /** Card exits this long before the Pokémon's name is spoken. */
  exitLead: 0.3,
  /** Shortest time the card stays up after it has popped in. */
  minCardHold: 0.6,
  /** Used when the name can't be found in the word timings. */
  nameFallback: 0.55,
  bgShift: 0.4,
} as const;

/** Music is ducked by this many dB while narration plays, ramping over this long. */
/** Background music gain before ducking. Measured: at 0.6 a CC0 track sat about 14 dB under the narration, which was barely audible. */
export const MUSIC = { volume: 0.9 } as const;

export const DUCK = { db: -12, rampMs: 150 } as const;

/** Mix a hex colour toward black; used for backgrounds so type colours stay readable behind cards. */
export const shade = (hex: string, amount: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

export const typeBackground = (type: string | undefined): string => (type && TYPE_COLORS[type] ? shade(TYPE_COLORS[type]!, 0.55) : NEUTRAL_BACKGROUND);
