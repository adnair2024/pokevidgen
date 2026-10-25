import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodType } from 'zod';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Anything under the repository root (teams/, runs/, ...). */
export const repoDir = (...parts: string[]): string => join(repoRoot, ...parts);
export const cacheDir = (...parts: string[]): string => join(repoRoot, 'data', 'cache', ...parts);
export const curatedDir = (...parts: string[]): string => join(repoRoot, 'data', 'curated', ...parts);

export const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Read a cache file and validate it; a malformed file is an error, never silently used. */
export const readCache = async <T>(path: string, schema: ZodType<T>): Promise<T> =>
  schema.parse(JSON.parse(await readFile(path, 'utf8')));

export const writeCache = async (path: string, data: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
};
