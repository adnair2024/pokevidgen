import type { FC } from 'hono/jsx';
import { describeStatus, type Team, type UploadRecord } from '@pokevidgen/core';
import type { Connection } from '../publish-service.js';
import type { RenderOutput } from '../store.js';
import { Notice } from './components.js';
import { Layout } from './layout.js';

const mb = (b: number): string => `${(b / 1e6).toFixed(1)} MB`;

const IP_NOTE =
  'This is fan content using Pokémon names and sprites (Nintendo / Game Freak IP). Do not present it as official, and think about that before monetizing.';

/** Does the upload still need watching? */
export const isSettled = (r: UploadRecord | undefined): boolean =>
  !r || r.state === 'failed' || (r.state === 'sent' && r.status !== 'PROCESSING_UPLOAD' && r.status !== undefined);

export const PublishPanel: FC<{ team: Team; connection: Connection; full?: RenderOutput; record?: UploadRecord; error?: string }> = ({ team, connection, full, record, error }) => {
  const watching = !isSettled(record);
  return (
    <section id="publish-panel" class="card publish" hx-get={watching ? `/teams/${team.id}/publish` : undefined} hx-trigger={watching ? 'every 3s' : undefined} hx-swap="outerHTML">
      <h2>TikTok</h2>
      {error && <Notice kind="error">{error}</Notice>}
      {!connection.configured ? (
        <p class="muted">TikTok isn't set up. See <a href="/publish">Publish</a> for the one-time steps.</p>
      ) : !connection.connected ? (
        <p class="muted">TikTok isn't connected. <a href="/publish">Connect your account</a> first.</p>
      ) : !full ? (
        <p class="muted">Render the full video first (the half-size preview is not uploaded).</p>
      ) : (
        <form hx-post={`/teams/${team.id}/publish/tiktok`} hx-target="#publish-panel" hx-swap="outerHTML" hx-disabled-elt="find button">
          <p>
            Sends <code>{full.file}</code> ({mb(full.size)}) to your TikTok inbox as a <strong>draft</strong>. Nothing is posted: you open the
            TikTok app, add the caption and press Post yourself.
          </p>
          <p class="muted">{IP_NOTE}</p>
          <label class="check"><input type="checkbox" name="confirm" /> Yes, send this video to my TikTok drafts</label>
          <button class="primary" type="submit" disabled={record?.state === 'uploading'}>Send to TikTok drafts</button>
        </form>
      )}
      {record && (
        <div class="job">
          <p>
            <span class={`chip ${record.state === 'failed' ? 'failed' : record.state === 'uploading' ? 'running' : 'done'}`}>{record.state}</span>{' '}
            {record.state === 'uploading' && `${mb(record.sentBytes)} of ${mb(record.totalBytes)} uploaded…`}
            {record.state === 'sent' && (record.status ? describeStatus(record.status) : 'Sent.')}
            {record.state === 'failed' && (record.error ?? 'Upload failed.')}
          </p>
          {record.state === 'sent' && record.error && <p class="muted">{record.error}</p>}
        </div>
      )}
    </section>
  );
};

export const PublishPage: FC<{ connection: Connection; message?: { kind: 'error' | 'ok'; text: string } }> = ({ connection, message }) => (
  <Layout title="Publish" active="/publish">
    <h1>Publish</h1>
    {message && <Notice kind={message.kind === 'ok' ? 'info' : 'error'}>{message.text}</Notice>}
    <p class="lead">
      Videos go to TikTok through its official Content Posting API only, as <strong>drafts in your inbox</strong>. You review each one and post it in
      the TikTok app. Nothing is posted automatically, and every send needs a confirmation on the video's page.
    </p>
    <section class="card">
      <h2>TikTok account</h2>
      <p>
        {!connection.configured && <span class="chip failed">not configured</span>}
        {connection.configured && !connection.connected && <span class="chip">not connected</span>}
        {connection.connected && <span class="chip done">connected</span>}
        {connection.connected && connection.expiresAt && <span class="muted"> until {new Date(connection.expiresAt).toISOString().slice(0, 10)} (renewed on use)</span>}
      </p>
      <div class="buttons row">
        {connection.configured && !connection.connected && <a class="button primary" href="/publish/tiktok/connect">Connect TikTok</a>}
        {connection.connected && (
          <form method="post" action="/publish/tiktok/disconnect"><button type="submit">Disconnect</button></form>
        )}
      </div>
    </section>
    <section class="card">
      <h2>One-time setup</h2>
      <ol>
        <li>Create an app at <code>developers.tiktok.com</code> and add the <strong>Content Posting API</strong> product with the <code>video.upload</code> scope.</li>
        <li>Register this redirect URI on the app (a desktop app allows <code>http://127.0.0.1</code>): <code>{connection.redirectUri}</code></li>
        <li>Put the app's keys in <code>.env</code> (never commit it): <code>TIKTOK_CLIENT_KEY</code> and <code>TIKTOK_CLIENT_SECRET</code>, then restart the dashboard.</li>
        <li>Add your own TikTok account as a test user while the app is in the sandbox, then press Connect.</li>
      </ol>
      <p class="muted">
        Tokens are stored in <code>data/publish/</code> (gitignored, owner-only). Uploads from an unaudited app may be limited or private until TikTok
        audits the app; that is TikTok's rule, not something this tool works around. {IP_NOTE}
      </p>
    </section>
  </Layout>
);
