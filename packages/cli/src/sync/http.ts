const THROTTLE_MS = 150;
let last = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Throttled fetch with a few retries; every network call in `data:sync` goes through here. */
export const throttledFetch = async (url: string, tries = 4): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    const wait = last + THROTTLE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (err) {
      if (attempt >= tries) throw err;
    }
    if (attempt >= tries) throw new Error(`gave up on ${url}`);
    await sleep(500 * attempt);
  }
};

export const fetchJson = async (url: string): Promise<unknown> => (await throttledFetch(url)).json();
