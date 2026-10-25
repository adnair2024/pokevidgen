import { readFile } from 'node:fs/promises';
import wordListPath from 'word-list';
import { loadPronunciations } from '../data/loaders.js';

let cached: Promise<Set<string>> | undefined;

/** Lowercase English words, loaded once (about 270k entries). */
export const loadDictionary = (): Promise<Set<string>> =>
  (cached ??= readFile(wordListPath, 'utf8').then((t) => new Set(t.split('\n').filter(Boolean))));

export const loadPronunciationWords = async (): Promise<Set<string>> =>
  new Set(Object.keys((await loadPronunciations()).words));
