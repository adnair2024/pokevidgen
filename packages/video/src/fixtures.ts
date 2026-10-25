import type { Manifest, Run } from './run.js';

/** A realistic six-pick run (the shape `core` writes), used by Studio and by tests. */
export const SAMPLE_RUN: Run = {
  id: 'sample-s1',
  title: 'Building a Kanto team',
  music: null,
  voiceover: {
    hook: 'Six Pokémon, one run. Can this Kanto team beat the Elite Four?',
    outro: "That's the team. Would you run it? Drop yours in the comments.",
  },
  picks: [
    {
      pokemon: 'nidoqueen', name: 'Nidoqueen', types: ['poison', 'ground'], dex: 31,
      intro: { kind: 'gymLeader', name: 'Agatha', title: 'Elite Four', types: ['ghost', 'poison'] },
      line: { text: 'For Agatha, we need an answer, and Nidoqueen is it. Earthquake wipes out Haunter in a single hit. Hyper Beam comes from TM15.', factIds: ['nidoqueen.vs-agatha'] },
      effect: null,
    },
    {
      pokemon: 'raichu', name: 'Raichu', types: ['electric'], dex: 26,
      intro: { kind: 'tm', move: 'thunderbolt', moveName: 'Thunderbolt', number: 24, moveType: 'electric', location: 'Vermilion Gym (Lt. Surge)' },
      line: { text: 'Raichu is how we deal with Lance. Thunderbolt knocks out Gyarados in one hit. It spreads paralysis, so slower enemies can barely move.', factIds: ['raichu.vs-lance'] },
      effect: 'lightning',
    },
    {
      pokemon: 'gyarados', name: 'Gyarados', types: ['water', 'flying'], dex: 130,
      intro: { kind: 'pokedex', genus: 'Atrocious Pokémon', heightM: 6.5, weightKg: 235 },
      line: { text: 'Gyarados comes in for Blaine. Hydro Pump knocks out Growlithe in one hit, and that decides the fight. Surf comes from HM3.', factIds: ['gyarados.vs-blaine'] },
      effect: 'bubbles',
    },
    {
      pokemon: 'parasect', name: 'Parasect', types: ['bug', 'grass'], dex: 47,
      intro: { kind: 'gymLeader', name: 'Lorelei', title: 'Elite Four', types: ['water', 'ice'] },
      line: { text: 'Parasect comes in for Lorelei. Solar Beam knocks out Cloyster in one hit, and that decides the fight. Dig comes from TM28.', factIds: ['parasect.vs-lorelei'] },
      effect: 'leaves',
    },
    {
      pokemon: 'snorlax', name: 'Snorlax', types: ['normal'], dex: 143,
      intro: { kind: 'tm', move: 'hyperbeam', moveName: 'Hyper Beam', number: 15, moveType: 'normal', location: 'Celadon Game Corner prize counter' },
      line: { text: 'Bruno looks scary, but Snorlax makes it easy. Hyper Beam wipes out Hitmonlee in a single hit. You can get it at Route 12.', factIds: ['snorlax.vs-bruno'] },
      effect: null,
    },
    {
      pokemon: 'machamp', name: 'Machamp', types: ['fighting'], dex: 68,
      intro: { kind: 'pokedex', genus: 'Superpower Pokémon', heightM: 1.6, weightKg: 130 },
      line: { text: 'Machamp comes in for Koga. Dig wipes out Koffing in a single hit, and that decides the fight. Strength comes from HM4.', factIds: ['machamp.vs-koga'] },
      effect: null,
    },
  ],
};

const words = (text: string, startMs: number, perWordMs: number) =>
  text.split(/\s+/).map((word, i) => ({ word, startMs: startMs + i * perWordMs, endMs: startMs + (i + 1) * perWordMs }));

/** A manifest for `SAMPLE_RUN`: 300 ms per word, so a line's length follows its word count. */
export const sampleManifest = (run: Run = SAMPLE_RUN, perWordMs = 300): Manifest => {
  const line = (key: string, text: string) => ({ key, file: `voice/${run.id}/${key}.wav`, durationMs: text.split(/\s+/).length * perWordMs, words: words(text, 0, perWordMs) });
  return { lines: [line('hook', run.voiceover.hook), ...run.picks.map((p) => line(p.pokemon, p.line.text)), line('outro', run.voiceover.outro)] };
};
