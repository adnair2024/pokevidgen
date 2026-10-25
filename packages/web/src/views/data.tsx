import type { FC } from 'hono/jsx';
import { JOBS, type Job } from '../jobs.js';
import type { DataStatus } from '../store.js';
import { Layout } from './layout.js';

/** Polls itself every second while the job runs, then stops. */
export const JobPanel: FC<{ job?: Job }> = ({ job }) => {
  if (!job) return <div id="job" class="muted">No job has run yet.</div>;
  const running = job.status === 'running';
  return (
    <div id="job" hx-get={running ? `/data/job/${job.id}` : undefined} hx-trigger={running ? 'every 1s' : undefined} hx-swap="outerHTML">
      <p><strong>{job.label}</strong> <span class={`chip ${job.status}`}>{job.status}</span></p>
      <pre class="log">{job.log.slice(-60).join('\n')}</pre>
    </div>
  );
};

export const DataPage: FC<{ status: DataStatus; job?: Job }> = ({ status, job }) => (
  <Layout title="Data" active="/data">
    <h1>Data</h1>
    <p class="lead">
      Everything is computed from data: PokeAPI for encounters and sprites, Smogon for sets, and the pret/pokered disassembly for bosses,
      learnsets and TMs. Nothing is fetched while you use the app, only when you run a sync here.
    </p>
    <div class="grid two">
      <section>
        <h2>Status</h2>
        <ul class="status">
          {status.synced.map((s) => <li class={s.ok ? 'ok' : 'bad'}>{s.label}: {s.count} file{s.count === 1 ? '' : 's'}</li>)}
          {status.curated.map((c) => <li class={c.ok ? 'ok' : 'bad'}>Curated {c.label}</li>)}
        </ul>
      </section>
      <section>
        <h2>Run</h2>
        <div class="buttons">
          {Object.entries(JOBS).map(([name, spec]) => (
            <button hx-post={`/data/run/${name}`} hx-target="#job" hx-swap="outerHTML">{spec.label}</button>
          ))}
        </div>
        <p class="muted">Syncs skip anything already cached, so re-running is cheap.</p>
      </section>
    </div>
    <JobPanel job={job} />
  </Layout>
);
