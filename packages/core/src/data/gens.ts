import { Dex } from '@pkmn/dex';
import { Generations, type Generation, type GenerationNum } from '@pkmn/data';

const generations = new Generations(Dex);

/** Every lookup goes through a gen-specific view so a gen 1 team never sees later-gen data. */
export const forGen = (num: GenerationNum): Generation => generations.get(num);
export type { Generation } from '@pkmn/data';
