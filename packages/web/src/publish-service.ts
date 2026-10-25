import { randomBytes } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import {
  TikTokError, TokensSchema, UploadsSchema, authorizeUrl, exchangeCode, fetchStatus, freshTokens, makePkce, readJson, repoDir, uploadToInbox,
  writeSecret, type Credentials, type Fetch, type Tokens, type UploadRecord,
} from '@pokevidgen/core';

export type Connection = { configured: boolean; connected: boolean; expiresAt?: number; redirectUri: string };

/** TikTok publishing behind one interface so tests can replace it. Only the inbox (draft) route; the person posts in the app. */
export interface PublishService {
  connection(): Promise<Connection>;
  /** Where to send the browser to approve access. Remembers the PKCE verifier for the callback. */
  connectUrl(): string;
  callback(query: { code?: string; state?: string; error?: string; error_description?: string }): Promise<void>;
  disconnect(): Promise<void>;
  /** Starts the upload in the background and returns at once; poll `record`. */
  send(runId: string, file: string): Promise<UploadRecord>;
  record(runId: string): Promise<UploadRecord | undefined>;
  /** Ask TikTok where the draft is now. */
  refresh(runId: string): Promise<UploadRecord | undefined>;
}

export const redirectUriFromEnv = (): string =>
  process.env['TIKTOK_REDIRECT_URI'] || `http://127.0.0.1:${process.env['PORT'] ?? 3000}/publish/tiktok/callback`;

export const createPublishService = (
  opts: { fetch?: Fetch; dir?: string; credentials?: () => Credentials | undefined; redirectUri?: () => string } = {},
): PublishService => {
  const fetchFn = opts.fetch ?? fetch;
  const dir = opts.dir ?? repoDir('data', 'publish');
  const tokenFile = `${dir}/tiktok.json`;
  const uploadsFile = `${dir}/tiktok-uploads.json`;
  const credentials = opts.credentials ?? ((): Credentials | undefined => {
    const clientKey = process.env['TIKTOK_CLIENT_KEY'];
    const clientSecret = process.env['TIKTOK_CLIENT_SECRET'];
    return clientKey && clientSecret ? { clientKey, clientSecret } : undefined;
  });
  const redirectUri = opts.redirectUri ?? redirectUriFromEnv;

  /** state -> PKCE verifier, for authorizations that have started but not returned. */
  const pending = new Map<string, { verifier: string; at: number }>();
  const needCredentials = (): Credentials => {
    const c = credentials();
    if (!c) throw new TikTokError('Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env first.', 'not_configured');
    return c;
  };

  const loadTokens = (): Promise<Tokens | undefined> => readJson(tokenFile, TokensSchema);

  /** A usable access token, refreshed and saved when needed. */
  const accessToken = async (): Promise<string> => {
    const t = await loadTokens();
    if (!t) throw new TikTokError('TikTok is not connected.', 'not_connected');
    const next = await freshTokens(fetchFn, needCredentials(), t);
    if (next !== t) await writeSecret(tokenFile, next);
    return next.accessToken;
  };

  const uploads = async () => (await readJson(uploadsFile, UploadsSchema)) ?? {};
  // Writes are queued so a late progress update can never overwrite the final state.
  let queue: Promise<unknown> = Promise.resolve();
  const save = (r: UploadRecord): Promise<UploadRecord> => {
    const done = queue.then(async () => { await writeSecret(uploadsFile, { ...(await uploads()), [r.runId]: r }); return r; });
    queue = done.catch(() => undefined);
    return done;
  };

  return {
    async connection() {
      const t = await loadTokens();
      return { configured: !!credentials(), connected: !!t && t.refreshExpiresAt > Date.now(), expiresAt: t?.refreshExpiresAt, redirectUri: redirectUri() };
    },

    connectUrl() {
      const c = needCredentials();
      const { verifier, challenge } = makePkce();
      const state = randomBytes(16).toString('hex');
      for (const [s, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(s);
      pending.set(state, { verifier, at: Date.now() });
      return authorizeUrl({ clientKey: c.clientKey, redirectUri: redirectUri(), state, challenge });
    },

    async callback(q) {
      if (q.error) throw new TikTokError(q.error_description || q.error, q.error);
      const entry = q.state ? pending.get(q.state) : undefined;
      if (!entry || !q.code) throw new TikTokError('This sign-in link is not one this dashboard started (or it expired). Try connecting again.', 'bad_state');
      pending.delete(q.state!);
      await writeSecret(tokenFile, await exchangeCode(fetchFn, needCredentials(), { code: q.code, redirectUri: redirectUri(), verifier: entry.verifier }));
    },

    async disconnect() {
      await rm(tokenFile, { force: true });
    },

    async send(runId, file) {
      const existing = (await uploads())[runId];
      if (existing?.state === 'uploading') return existing;
      const total = (await stat(file)).size;
      const token = await accessToken();
      const start = await save({ runId, file, state: 'uploading', sentBytes: 0, totalBytes: total, at: Date.now() });
      // Runs in the background; the page polls `record`.
      void uploadToInbox(fetchFn, token, file, (sent) => { void save({ ...start, sentBytes: sent, at: Date.now() }); })
        .then(({ publishId }) => save({ ...start, state: 'sent', publishId, sentBytes: total, status: 'PROCESSING_UPLOAD', at: Date.now() }))
        .catch((err: unknown) => save({ ...start, state: 'failed', error: err instanceof Error ? err.message : String(err), at: Date.now() }));
      return start;
    },

    async record(runId) {
      return (await uploads())[runId];
    },

    async refresh(runId) {
      const r = (await uploads())[runId];
      if (!r?.publishId || r.state !== 'sent') return r;
      try {
        const s = await fetchStatus(fetchFn, await accessToken(), r.publishId);
        return await save({ ...r, status: s.status, error: s.status === 'FAILED' ? `TikTok: ${s.failReason ?? 'failed'}` : undefined, at: Date.now() });
      } catch (err) {
        return { ...r, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
};
