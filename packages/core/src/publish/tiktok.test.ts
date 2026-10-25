import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHUNK, MIN_CHUNK, TikTokError, freshTokens, makePkce, planChunks, uploadToInbox, type Tokens } from './tiktok.js';

describe('planChunks', () => {
  it('sends a file under 5 MB whole', () => {
    expect(planChunks(MIN_CHUNK - 1)).toEqual({ chunkSize: MIN_CHUNK - 1, count: 1, ranges: [[0, MIN_CHUNK - 2]] });
  });

  it('folds the remainder into the last chunk so no chunk is under 5 MB', () => {
    // TikTok's own example: 50,000,123 bytes in 10,000,000-byte chunks is 5 chunks, the last carrying the extra 123.
    const plan = planChunks(50_000_123);
    expect(plan.count).toBe(5);
    expect(plan.ranges.at(-1)).toEqual([40_000_000, 50_000_122]);
    for (const [a, b] of plan.ranges) expect(b - a + 1).toBeGreaterThanOrEqual(MIN_CHUNK);
  });

  it('covers every byte exactly once, in order', () => {
    for (const size of [MIN_CHUNK, CHUNK, CHUNK + 1, 3 * CHUNK - 1, 87_654_321]) {
      const { ranges } = planChunks(size);
      expect(ranges[0]![0]).toBe(0);
      for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1);
      expect(ranges.at(-1)![1]).toBe(size - 1);
    }
  });

  it('rejects an empty file', () => {
    expect(() => planChunks(0)).toThrow(TikTokError);
  });
});

describe('makePkce', () => {
  it('uses a long verifier and the hex SHA-256 challenge TikTok documents', () => {
    const { verifier, challenge } = makePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('hex'));
    expect(makePkce().verifier).not.toBe(verifier);
  });
});

describe('freshTokens', () => {
  const tokens = (over: Partial<Tokens>): Tokens => ({ accessToken: 'a', refreshToken: 'r', openId: 'o', scope: 'video.upload', accessExpiresAt: 0, refreshExpiresAt: 0, ...over });
  const creds = { clientKey: 'k', clientSecret: 's' };

  it('keeps a token that is still good', async () => {
    const t = tokens({ accessExpiresAt: 10_000_000, refreshExpiresAt: 99_999_999 });
    const never = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
    expect(await freshTokens(never, creds, t, 1000)).toBe(t);
  });

  it('refreshes an expired access token and keeps the new refresh token', async () => {
    let body = '';
    const fake = (async (_u: unknown, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', open_id: 'o', scope: 'video.upload', expires_in: 86400, refresh_expires_in: 31536000 }));
    }) as typeof fetch;
    const next = await freshTokens(fake, creds, tokens({ accessExpiresAt: 500, refreshExpiresAt: 99_999_999 }), 1000);
    expect(new URLSearchParams(body).get('grant_type')).toBe('refresh_token');
    expect(next).toMatchObject({ accessToken: 'a2', refreshToken: 'r2', accessExpiresAt: 1000 + 86400_000 });
  });

  it('asks to reconnect when the refresh token has expired', async () => {
    await expect(freshTokens(fetch, creds, tokens({ refreshExpiresAt: 500 }), 1000)).rejects.toMatchObject({ code: 'refresh_expired' });
  });
});

describe('uploadToInbox', () => {
  let dir: string;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('uploads a multi-chunk file in order with the right ranges and the exact bytes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tiktok-'));
    const size = 2 * CHUNK + 777;
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1000) data[i] = (i / 1000) % 251;
    const file = join(dir, 'v.mp4');
    await writeFile(file, data);

    const received: Array<{ range: string; bytes: Buffer }> = [];
    let init: unknown;
    const fake = (async (url: string, req?: RequestInit) => {
      if (url.endsWith('/inbox/video/init/')) {
        init = JSON.parse(String(req!.body));
        return new Response(JSON.stringify({ data: { publish_id: 'p1', upload_url: 'https://u.example/x' }, error: { code: 'ok' } }));
      }
      received.push({ range: new Headers(req!.headers).get('content-range')!, bytes: Buffer.from(req!.body as Uint8Array) });
      return new Response(null, { status: received.length === 2 ? 201 : 206 });
    }) as unknown as typeof fetch;

    const progress: number[] = [];
    const { publishId } = await uploadToInbox(fake, 'tok', file, (sent) => progress.push(sent));
    expect(publishId).toBe('p1');
    expect(init).toEqual({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: CHUNK, total_chunk_count: 2 } });
    expect(received.map((r) => r.range)).toEqual([`bytes 0-${CHUNK - 1}/${size}`, `bytes ${CHUNK}-${size - 1}/${size}`]);
    expect(Buffer.concat(received.map((r) => r.bytes)).equals(data)).toBe(true);
    expect(progress).toEqual([CHUNK, size]);
  });

  it('turns a TikTok error into a TikTokError with its code', async () => {
    dir ??= await mkdtemp(join(tmpdir(), 'tiktok-'));
    const file = join(dir, 'small.mp4');
    await writeFile(file, Buffer.alloc(100));
    const fake = (async () => new Response(JSON.stringify({ error: { code: 'scope_not_authorized', message: 'no scope', log_id: 'L1' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(uploadToInbox(fake, 'tok', file)).rejects.toMatchObject({ code: 'scope_not_authorized', logId: 'L1' });
  });

  it('stops and reports a failed chunk upload', async () => {
    dir ??= await mkdtemp(join(tmpdir(), 'tiktok-'));
    const file = join(dir, 'small2.mp4');
    await writeFile(file, Buffer.alloc(100));
    const fake = (async (url: string) =>
      url.endsWith('/init/') ? new Response(JSON.stringify({ data: { publish_id: 'p', upload_url: 'https://u.example/' }, error: { code: 'ok' } })) : new Response('nope', { status: 403 })) as unknown as typeof fetch;
    await expect(uploadToInbox(fake, 'tok', file)).rejects.toThrow(/HTTP 403/);
  });
});
