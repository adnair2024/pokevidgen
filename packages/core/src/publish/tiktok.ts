import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, stat, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { exists } from '../data/index.js';

/**
 * TikTok Content Posting API, "upload to inbox" route only: the video lands in the creator's TikTok app as a draft
 * and the person finishes and posts it there. Scope `video.upload`. Nothing here posts publicly or automates the app.
 * Endpoints and rules: developers.tiktok.com (Content Posting API, Login Kit for desktop).
 */
const API = 'https://open.tiktokapis.com';
export const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const SCOPE = 'video.upload';

/** Chunk rules from TikTok's media transfer guide: 5-64 MB per chunk, the last may be up to 128 MB, under 5 MB goes whole. */
export const MIN_CHUNK = 5_000_000;
export const CHUNK = 10_000_000;

export class TikTokError extends Error {
  constructor(message: string, readonly code: string, readonly logId?: string) {
    super(message);
  }
}

export type Fetch = typeof fetch;

export const TokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  openId: z.string(),
  scope: z.string(),
  /** Epoch ms. Access tokens last 24 h, refresh tokens a year. */
  accessExpiresAt: z.number(),
  refreshExpiresAt: z.number(),
});
export type Tokens = z.infer<typeof TokensSchema>;

export type Pkce = { verifier: string; challenge: string };

/** TikTok documents the challenge as the hex-encoded SHA-256 of the verifier (not base64url as in RFC 7636). */
export const makePkce = (): Pkce => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('hex') };
};

export const authorizeUrl = (o: { clientKey: string; redirectUri: string; state: string; challenge: string }): string => {
  const q = new URLSearchParams({
    client_key: o.clientKey, scope: SCOPE, response_type: 'code', redirect_uri: o.redirectUri, state: o.state,
    code_challenge: o.challenge, code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${q}`;
};

type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string } };

const parseApi = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  let json: ApiEnvelope<T> & Record<string, unknown>;
  try { json = JSON.parse(text) as typeof json; } catch { throw new TikTokError(`TikTok returned HTTP ${res.status} with a non-JSON body`, 'bad_response'); }
  const err = json.error;
  // Token endpoints return the error at the top level (`error`, `error_description`), content endpoints in `error.code`.
  if (typeof json['error'] === 'string') throw new TikTokError(String(json['error_description'] ?? json['error']), String(json['error']), String(json['log_id'] ?? ''));
  if (!res.ok || (err?.code && err.code !== 'ok')) throw new TikTokError(err?.message || `HTTP ${res.status}`, err?.code ?? `http_${res.status}`, err?.log_id);
  return (json.data ?? (json as unknown as T)) as T;
};

type TokenResponse = { access_token: string; refresh_token: string; open_id: string; scope: string; expires_in: number; refresh_expires_in: number };

const toTokens = (r: TokenResponse, now: number): Tokens => ({
  accessToken: r.access_token, refreshToken: r.refresh_token, openId: r.open_id, scope: r.scope,
  accessExpiresAt: now + r.expires_in * 1000, refreshExpiresAt: now + r.refresh_expires_in * 1000,
});

const tokenRequest = async (fetchFn: Fetch, form: Record<string, string>, now: number): Promise<Tokens> => {
  const res = await fetchFn(`${API}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams(form),
  });
  return toTokens(await parseApi<TokenResponse>(res), now);
};

export type Credentials = { clientKey: string; clientSecret: string };

export const exchangeCode = (
  fetchFn: Fetch, c: Credentials, o: { code: string; redirectUri: string; verifier: string }, now = Date.now(),
): Promise<Tokens> =>
  tokenRequest(fetchFn, { client_key: c.clientKey, client_secret: c.clientSecret, code: o.code, grant_type: 'authorization_code', redirect_uri: o.redirectUri, code_verifier: o.verifier }, now);

export const refreshTokens = (fetchFn: Fetch, c: Credentials, refreshToken: string, now = Date.now()): Promise<Tokens> =>
  tokenRequest(fetchFn, { client_key: c.clientKey, client_secret: c.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }, now);

/** An access token good for at least a minute, refreshed (and saved by the caller) when it has run out. */
export const freshTokens = async (fetchFn: Fetch, c: Credentials, t: Tokens, now = Date.now()): Promise<Tokens> => {
  if (t.accessExpiresAt - now > 60_000) return t;
  if (t.refreshExpiresAt <= now) throw new TikTokError('The TikTok connection has expired. Connect again.', 'refresh_expired');
  return refreshTokens(fetchFn, c, t.refreshToken, now);
};

/**
 * Split a file into chunks: whole when under 5 MB, otherwise `CHUNK`-sized with the remainder folded into the last chunk
 * so that no chunk is under 5 MB.
 */
export const planChunks = (size: number, chunk = CHUNK): { chunkSize: number; count: number; ranges: Array<[number, number]> } => {
  if (!Number.isInteger(size) || size <= 0) throw new TikTokError('The video file is empty.', 'empty_file');
  // Under two chunks' worth goes whole (one chunk may be up to 64 MB, the last up to 128 MB), which also avoids a chunk under 5 MB.
  if (size < 2 * chunk) return { chunkSize: size, count: 1, ranges: [[0, size - 1]] };
  const count = Math.floor(size / chunk);
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) ranges.push([i * chunk, i === count - 1 ? size - 1 : (i + 1) * chunk - 1]);
  return { chunkSize: chunk, count, ranges };
};

export type UploadProgress = (sent: number, total: number) => void;

/** Ask TikTok for an upload slot, then PUT the file in order. Returns the id to poll with `fetchStatus`. */
export const uploadToInbox = async (
  fetchFn: Fetch, accessToken: string, file: string, onProgress: UploadProgress = () => {},
): Promise<{ publishId: string }> => {
  const size = (await stat(file)).size;
  const plan = planChunks(size);
  const init = await parseApi<{ publish_id: string; upload_url: string }>(
    await fetchFn(`${API}/v2/post/publish/inbox/video/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count } }),
    }),
  );
  const handle = await open(file, 'r');
  try {
    for (const [first, last] of plan.ranges) {
      const length = last - first + 1;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, first);
      const res = await fetchFn(init.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(length), 'Content-Range': `bytes ${first}-${last}/${size}` },
        body: buf,
      });
      // 206 for each chunk but the last, 201 for the final one.
      if (res.status !== 201 && res.status !== 206 && res.status !== 200) {
        throw new TikTokError(`Upload of bytes ${first}-${last} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, `upload_${res.status}`);
      }
      onProgress(last + 1, size);
    }
  } finally {
    await handle.close();
  }
  return { publishId: init.publish_id };
};

export type PublishStatus = 'PROCESSING_UPLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED' | (string & {});

export const fetchStatus = async (fetchFn: Fetch, accessToken: string, publishId: string): Promise<{ status: PublishStatus; failReason?: string }> => {
  const d = await parseApi<{ status: string; fail_reason?: string }>(
    await fetchFn(`${API}/v2/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id: publishId }),
    }),
  );
  return { status: d.status, failReason: d.fail_reason };
};

/** Human wording for a TikTok status. */
export const describeStatus = (status: PublishStatus): string => {
  switch (status) {
    case 'PROCESSING_UPLOAD': return 'TikTok is still receiving the upload.';
    case 'SEND_TO_USER_INBOX': return 'In your TikTok inbox as a draft. Open the TikTok app, finish the caption and post it there.';
    case 'PUBLISH_COMPLETE': return 'Posted from the TikTok app.';
    case 'FAILED': return 'TikTok rejected the video.';
    default: return status;
  }
};

// --- local state: tokens and upload records. Both live in data/publish/, which is gitignored.

export const readJson = async <T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T | undefined> => {
  if (!(await exists(path))) return undefined;
  const parsed = schema.safeParse(JSON.parse(await readFile(path, 'utf8')));
  return parsed.success ? parsed.data : undefined;
};

/** Written with mode 0600: the file holds an account token. */
export const writeSecret = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
};

export const UploadRecordSchema = z.object({
  runId: z.string(),
  file: z.string(),
  state: z.enum(['uploading', 'sent', 'failed']),
  /** Last status TikTok reported. */
  status: z.string().optional(),
  publishId: z.string().optional(),
  error: z.string().optional(),
  sentBytes: z.number().default(0),
  totalBytes: z.number().default(0),
  at: z.number(),
});
export type UploadRecord = z.infer<typeof UploadRecordSchema>;
export const UploadsSchema = z.record(UploadRecordSchema);
