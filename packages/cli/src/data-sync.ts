import { parseArgs } from 'node:util';
import { syncEncounters, syncSpecies } from './sync/pokeapi.js';
import { syncSets } from './sync/smogon.js';

const TARGETS = ['encounters', 'species', 'sets'] as const;
type Target = (typeof TARGETS)[number];

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    format: { type: 'string', multiple: true },
  },
});

const only = values.only as Target | undefined;
if (only && !TARGETS.includes(only)) {
  console.error(`--only must be one of: ${TARGETS.join(', ')}`);
  process.exit(1);
}
const run = (t: Target) => !only || only === t;

if (run('encounters')) console.log(`encounters: fetched ${await syncEncounters()} new file(s)`);
if (run('species')) console.log(`species + sprites: fetched ${await syncSpecies()} new file(s)`);
if (run('sets')) {
  for (const format of values.format ?? ['gen1ou']) {
    console.log(`sets ${format}: ${(await syncSets(format)) ? 'fetched' : 'cached'}`);
  }
}
