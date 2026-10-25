import { toID as pkmnToID } from '@pkmn/dex';

/** Normalize any name ("Mr. Mime", "mr-mime") to the pkmn ID format used internally. */
export const toID = (name: string): string => pkmnToID(name);
