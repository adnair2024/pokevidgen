# pokevidgen

A Pokémon team-building engine with a local web dashboard: build in-game teams (Red and Blue so far) from real game data,
read the strategy for every gym leader and boss, and turn a team into a vertical "draft run" short.

Fan project. Pokémon is © Nintendo / Game Freak. Not official.

## Run it

```bash
pnpm install
pnpm web                 # dashboard at http://127.0.0.1:3000 (loopback only)
```

Open **Data** in the dashboard and run "Sync all data" once (PokeAPI and Smogon; about 2 minutes). Then **Build a team**, and
use the **Video** tab to generate a script, edit it, add a voice, and render. Or press **Make video** on the build form to do it all in one
click (team, script, narration, full render; about 15 minutes in the background). The voice needs a one-time setup (a Python
environment and about 500 MB of models): press "Set up voice" there, or run `pnpm voice setup`. `uv` and `espeak-ng` must be installed.

## Command line

```bash
pnpm data:sync                              # fetch and cache PokeAPI / Smogon data
pnpm run team ingame --game red --seed 1    # note: `pnpm team` is a pnpm built-in, so use `pnpm run team`
pnpm make --game red --seed 1              # team -> script -> voice -> full render, in one command (random seed if omitted)
pnpm make --game red --favorite charizard   # "if your favorite is Charizard" video: a team built around it, shown first
pnpm make --game red --review              # stop after the script; edit runs/<id>.json, then: pnpm make --resume <id>
pnpm voice generate runs/red-s1.json       # narration with Kokoro + Whisper timings (cached per line)
pnpm video render runs/red-s1.json --scale 0.5 --manifest packages/video/public/voice/red-s1/manifest.json
pnpm typecheck && pnpm test
node node_modules/eslint/bin/eslint.js .    # lint
```

Rendering needs a Chromium-based browser. Remotion's bundled Chrome crashes on some systems; the renderer uses
`/usr/bin/brave`, `chromium` or `google-chrome` if present, or whatever `POKEVIDGEN_BROWSER` points at.

See `CLAUDE.md` for the design and `TODO.md` for what is done and what is next.

## Publishing to TikTok (drafts only)

The **Publish** page connects your TikTok account through the official Content Posting API and the Video tab can send the rendered
video to your TikTok **inbox as a draft**. It never posts by itself: you open TikTok, add the caption and press Post. Every send needs a
confirmation tick. One-time setup: create an app at developers.tiktok.com with the Content Posting API (`video.upload` scope), register the
redirect URI shown on the Publish page, put `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` in `.env`, and add your account as a test user.
Tokens are kept in `data/publish/` (gitignored, owner-only). Unaudited TikTok apps may be limited by TikTok; this tool does not work around that.
