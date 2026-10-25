# TODO

Ordered so each milestone produces something runnable. See `CLAUDE.md` for the full spec.

## M0: Foundation
- [x] pnpm workspace, strict TS config, `.gitignore`, `.env.example`
- [x] `core/types.ts` zod schemas (Set, Member, Team)
- [x] `pnpm typecheck` passes (cli placeholder added)
- [x] ESLint flat config (`eslint.config.js`) so `pnpm lint` runs
- [x] vitest config + one smoke test so `pnpm test` runs
- [x] Allow esbuild build script (`pnpm.onlyBuiltDependencies`)
- [ ] Commit baseline (incl. `.pawl/`)

## M1: Data layer
- [x] `core/data`: gen-aware loaders (`forGen`), `toID`, cache read/write helpers
- [x] `data:sync`: PokeAPI encounters (red/blue/yellow), species data and sprites, throttled, skips cached
- [x] `data:sync`: Smogon sets per format (`--only encounters|species|sets`, `--format`, default gen1ou)
- [x] zod schemas for every cache file
- [x] Tests: gen-correct lookups (gen 1: no Fairy/abilities/items, single Special, Ghost vs Psychic)
- [ ] Sync usage stats (`@pkmn/smogon`), needed by M6, not M2-M5

## M2: Game configs and curated data (Gen 1: Red and Blue; Yellow deferred, Green dropped)
- [x] `games/red.ts`, `games/blue.ts` + registry (`getGame`)
- [x] `data/curated/gen1/bosses.json`: all gym leaders, Elite Four, rival (3 starter variants), Giovanni x3, imported from pret/pokered at a pinned commit (`pnpm --filter @pokevidgen/cli exec tsx src/curated/import-gen1-bosses.ts`)
- [x] `data/curated/gen1/progression.json`: area stages, rod/Surf gating, evolution stones (stones verified against pokered; area stages hand-assigned, see its source note)
- [x] `ingame/availability.ts`: earliest stage per species, wild/water/gift/static/trade/prize/fossil/evolution, `--no-trades`, `--no-legendaries`
- [x] Tests from cached data: version exclusives, Mew, no-trades, no-legendaries, method gating
- [ ] Review the hand-assigned area stages in `progression.json` (typical story order; sequence breaking reaches areas earlier)
- [ ] Boss moves: gen 1 trainers use learnset-derived moves plus `special_moves.asm` (Gym leader lone moves, Elite Four team moves); not imported yet, species and levels only
- [ ] NPC trade levels are unreliable in PokeAPI (they follow the Pokémon you hand over); modelled as unset
- [ ] Mutually exclusive sources (Helix vs Dome fossil, Moon Stone count) for the planner to respect in M4
- [ ] Yellow config (different bosses and encounters) when wanted

## M3: Analysis
- [x] `analysis/coverage.ts`: gen-correct effectiveness, defensive profile, team defense and shared weaknesses, offensive coverage, STAB matchup
- [x] `analysis/calc.ts`: `@smogon/calc` wrapper with gen 1-2 stats computed from DVs and stat exp (the library hardcodes max stat exp). Presets: trainer (verified in pokered), baseline player, max
- [x] `analysis/roles.ts`: gen 1 role detection from moves, base stats and learnsets; throws for gens with no definitions
- [x] Per-gen tests (gen 1/2/6 type charts, Steel vs Ghost/Dark, stat formula cross-checked against the library)
- [ ] Role definitions for gens 2+ (hazards, removal, pivoting) when a later game or format is added
- [ ] Role thresholds (`FAST_BASE_SPEED`, `BULKY_BASE_HP`) are heuristics; revisit against real boss matchups in M4
- [ ] Player stat exp: the baseline preset is a floor. Model stat exp growth by level if boss calcs prove too pessimistic
- [ ] Gen 3+ calc path (`options` passthrough) is untested

## M4: In-game planner
- [x] Candidates from availability (final forms), constraint filter (`--must`, `--ban`, `--no-trades`, `--no-legendaries`, `--nuzlocke`), exclusive gifts, single Eevee, Moon Stone supply
- [x] Greedy marginal scoring (timing, boss coverage, stats, movepool, roles, shared weaknesses), seeded softmax sampling so seeds explore near-ties
- [x] Move legality with "learned when": level-up (from pokered learnsets), start moves by the game's last-four rule, TM/HM with location and stage, single-use TMs
- [x] `ingame/bosses.ts`: per-boss plan with usable members at that point, their moves then, and calcs both ways (answer + threat), warnings
- [x] `pnpm run team ingame --game red --seed 1` works with no API key (note: `pnpm team` is a pnpm built-in, so use `pnpm run team`)
- [x] Curated from pokered: bosses with moves, learnsets (start, level-up, TM/HM), TMs with locations, rival starter rule, exclusive gifts
- [ ] Scoring is type-based (STAB matchups). Use calcs for candidate fit once boss moves and levels are modelled per candidate
- [ ] Our level in boss calcs is the boss's ace level and the player profile is the pessimistic baseline; model real levels and stat exp growth
- [ ] PokeAPI marks some purchases as "gift" (Magikarp costs 500 at the Route 4 Pokémon Center); describe them correctly
- [ ] HM badge requirements are folded into area stages; moves taught by HM are not checked against the badge needed to use them
- [ ] NPC-trade levels, and giving up a Pokémon to a trade, are not modelled
- [ ] More styles than "balanced" (the `--style` flag only accepts it today)
- [x] Team synergy (measured on 200 teams before and after): two weak with nothing resisting 48% -> 0%, shared primary type 56% -> 0%, Hyper Beam users 3.7 -> 1.0, types not hit super effectively 4.4 -> 2.8, 79 distinct species across 200 teams. One team objective (own merit, boss coverage, roles, `analysis/synergy.ts`) drives picks and a repair pass; seeded anchor and temperature keep seeds varied
- [ ] Normal-type members are still about 0.9 per team (Chansey, Kangaskhan, Wigglytuff): allowed one, penalized beyond. Decide whether to cut it to zero unless required
- [ ] Synergy proxies offensive reach from each Pokémon's potential moves; the real set can differ slightly
- [ ] Interest beyond type balance (signature Pokémon, themed teams such as mono-type or "no evolutions") is not modelled

## M5: Exporters
- [x] `export/markdown.ts`: write-up (overview, where/when per member, boss-by-boss strategy with calcs, items/TMs checklist), shown and downloadable from the dashboard
- [ ] Showdown paste export via `@pkmn/sets` with round-trip test (deferred: skipped for now, by request)
- [ ] `pnpm run team explain` CLI (the dashboard already does this)

## Web dashboard (everything lives here)
- [x] `packages/web`: Hono + JSX server rendering + htmx, no build step. `pnpm web` (or `pnpm web:dev` to reload on change), http://127.0.0.1:3000, loopback only
- [x] Dashboard, build form (game, seed, must, ban, no trades, no legendaries, nuzlocke), team list, team page (team, types, bosses, write-up tabs), bosses reference, data page with whitelisted sync/import jobs and live logs
- [x] Tests with a temp teams dir: flows, validation, path traversal, HTML escaping of team files
- [ ] Visual check in a real browser (no browser was available when this was built)
- [ ] Edit a team from the page (swap a member, change a move) with the same legality checks as the planner
- [ ] Compare two seeds side by side
- [ ] Surface future features here as they land: video run builder and preview, script editor and lint, voice generation, renders
- [ ] Competitive builder pages when M6 is picked up

## M6: Competitive builder (Showdown export deferred)
- [ ] `competitive/validate.ts` wrapping `TeamValidator` (hard error on failure)
- [ ] `sets.ts`, `threats.ts`, `builder.ts`
- [ ] `pnpm team showdown --format gen9ou --seed 1`, `validate` and `calc` commands
- [ ] Golden tests: known-legal and known-illegal pastes

## M7: Facts, script, lint
- [x] `script/facts.ts`: citable facts with IDs (matchup, calc, move, availability, role) from the team and the damage calcs, each listing the Pokémon, moves and numbers it allows
- [x] `script/templates.ts`: seeded template writer, no API key; every line is built from fact fields; overkill reads as a knockout; varies tails and avoids repeating moves
- [x] `script/lint.ts`: word limits, 55-80 s window, name present, fact ids valid, pronunciation warnings (English dictionary + `data/curated/pronunciations.json`), claims check for model-written lines
- [x] `export/run.ts`: team to run JSON with intro cards (gym leader / TM / Pokédex) and effects, picks in the order you would get them
- [x] Dashboard Video tab: generate, regenerate by seed, edit hook / lines / outro / cited facts, lint after every save; edits are marked so a regenerate warns first
- [ ] `pnpm voice lint` CLI wrapper (the dashboard already lints)
- [ ] Review the respellings in `pronunciations.json` by ear once voices exist (M9)

## M8: Video (no voice)
- [x] Remotion project in `packages/video`: `theme.ts` (all colours and default timing), pixel font, run and manifest schemas of its own
- [x] `timeline.ts`: pure `(run, fps, manifest?) -> beats`, whole frames, anchors on the name's first frame, min visual time, 55% fallback, no overlaps; tests with and without a manifest
- [x] Grid of six slots, Pokéball that opens, Pokémon plus name/type plate, Gym Leader / TM / Pokédex cards, six effects, word-by-word captions (estimated until a voice exists), background shifting to each type, grid dim and blur under cards
- [x] Music ducking (`duckVolume`, -12 dB with 150 ms ramps) and voice `<Audio>` plumbing, driven by the manifest
- [x] `renderRun` + `pnpm video render runs/<id>.json [--scale 0.5] [--frames a-b] [--still N]`
- [x] Dashboard: Render panel (preview, full, single frame) as background jobs with live log, player with seeking, downloads
- [x] Rendered and inspected: stills of every card type and effect, and a full 66.9 s preview (H.264, 30 fps, 2006 frames) in 4 min 14 s
- [x] Intro cards varied: at most four gym cards per video, the rest TM and Pokédex
- [ ] A full-size 1080x1920 render has not been run end to end (measured ~280-370 ms/frame, so about 10-12 min)
- [ ] Music has never been tried with a real audio file; `run.music` is null in every generated run
- [ ] Voice timing is untested with real audio until M9 (the timeline logic is unit-tested with fixture manifests)
- [ ] `pnpm video:studio` (Remotion Studio) is wired but untested here
- [ ] No trainer sprites are available from PokeAPI, so gym leader cards use an emblem with the leader's initial and types
- [ ] The accented E in POKEDEX looks rough in the pixel font
- [ ] Captions and the 64 px safe zone have been checked by eye on stills only, not on a phone
- [ ] Rendering: Remotion's own Chrome segfaults on this machine; `findBrowser()` uses an installed Chromium-based browser (Brave here). Consider an installer job for a current `chrome-headless-shell` (about 25% faster)

## M9: Voice
- [x] `tools/voice/` Python sidecar (uv): Kokoro via `kokoro-onnx` (CPU, Apache 2.0; avoids PyTorch's multi-GB CUDA wheels), faster-whisper for word timings, one JSON request on stdin and one response on stdout; `pnpm voice setup` installs it and downloads about 500 MB of models
- [x] `voice/`: engine interface, content-addressed cache (hash of engine, model, voice, speed and the text after pronunciation), batching, per-line files, validated `manifest.json`
- [x] `align.ts`: Whisper's words matched back onto the script's words by edit distance over the respelled text; unreliable matches (one syllable, zero-length) are interpolated or stretched; tested on real Whisper output with misheard names
- [x] Pronunciation: respellings applied to the speech text only, never captions; letter-digit codes (TM15, B1F) read letter by letter
- [x] Optional engines: ElevenLabs (own word timings, dry-run cost note, licensing warning) and Piper, tested with mocked HTTP and process calls
- [x] `pnpm voice setup | lint | script | generate | preview | tune`
- [x] Timeline and captions use the real manifest; renders use the narration only while it still matches the script
- [x] Dashboard: Voice section on the Video tab (settings, per-line status, cost check, generate and preview jobs, a player per line) and a Pronunciations page to audition, edit, add and remove respellings
- [x] Ran for real: 8 lines in 2.5 min (59.1 s of narration at 1.1x), second run is fully cached
- [ ] Nobody has listened to it yet: intelligibility was checked with Whisper as a proxy only. Listen in the dashboard and tune respellings by ear
- [ ] `pnpm voice tune` scored respellings by Whisper; its results are a guide, not a replacement for listening
- [x] Rendered the full preview with narration: 63.3 s H.264 plus AAC, speech starts 70-90 ms after each scheduled line start, audio present (mean -25.8 dB)
- [ ] Listen to that video (quality of the voice and of the name pronunciations)
- [ ] ElevenLabs and Piper engines have never run against the real service / binary
- [ ] Inline phoneme overrides for names a respelling cannot fix (Kokoro supports them; not wired up)
- [ ] Voice quality at speed 1.1 vs 1.0, and other Kokoro voices, are unexplored

## M10: `pnpm make` and random
- [x] One-click "Make video" on the build form and the Video tab: team (random seed unless given) -> script -> lint -> voice -> full (or half-size) render, one background job; refuses if voice isn't set up or another job runs
- [x] `pnpm make --game red [--seed N] [--preview] [--review]` and `pnpm make --resume <id>`
- [ ] Input parsing: paste, name list, description, partial teams (fuzzy name matching)
- [ ] `--fix` / `--as-is`
- [ ] Draft ("pick 1 of 3"), random and chaos modes, `--batch`

## M11: Optional LLM layer
- [ ] `llm/planner.ts` and `schemas.ts`, with zod and re-checking against data
- [ ] `--llm` script writer restricted to the supplied facts

## Publishing
- [x] TikTok via the official Content Posting API only: OAuth (PKCE, `video.upload` scope), "upload to inbox" (a draft you finish and post in the app), chunked upload, status polling, token refresh. Publish page + panel on the Video tab; confirmation tick per video; IP note shown; tokens in gitignored `data/publish/` (mode 0600)
- [x] Tested against a faked TikTok HTTP layer (chunk planning, ranges, exact bytes, token exchange/refresh, error mapping, the dashboard flow)
- [ ] **Never run against the real TikTok API**: needs a developer app and keys. Unverified details: the hex-encoded PKCE challenge (per TikTok's docs, not RFC 7636's base64url), whether `http://127.0.0.1` redirects are accepted for your app type, and what an unaudited app is allowed to upload
- [ ] Direct post (public posting, `video.publish`) is not built; it needs TikTok's audit, a creator-info query and a privacy choice UI
- [ ] Captions / hashtags for the draft are not sent (add them in the TikTok app)
- [ ] YouTube Shorts via the YouTube Data API as a second target
- [ ] YouTube Shorts via the YouTube Data API as a second target

## Needs a decision
- [x] Install `uv` (Python sidecar) and run `espeak-ng` setup checks before M9
- [ ] Pick which games and formats to support after Gen 1 (and a first competitive format, e.g. gen1ou or gen9ou)
