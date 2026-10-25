import { serve } from '@hono/node-server';
import { loadEnv } from '@pokevidgen/core';
import { createApp } from './app.js';
import { createDeps } from './deps.js';

await loadEnv();
const port = Number(process.env['PORT'] ?? 3000);
// Local tool: bind to loopback only, since the Data page can run commands.
const hostname = process.env['HOST'] ?? '127.0.0.1';

serve({ fetch: createApp(createDeps()).fetch, port, hostname }, (info) => {
  console.log(`pokevidgen dashboard: http://${hostname}:${info.port}`);
});
