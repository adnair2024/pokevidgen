# CLAUDE.md

## What this is

A Pokémon team-building engine with several outputs:

1. **In-game teams.** Build a team for a specific game (Crystal, Emerald, Platinum, HeartGold, Scarlet, …) using only what's actually obtainable there, with a route-by-route plan for catching and training it and a strategy for every gym leader and boss.
2. **Competitive teams.** Build Pokémon Showdown teams for a format (gen9ou, gen9vgc2026, gen2ou, gen9randombattle-style sets, …) with full sets: item, ability, nature, EVs/IVs, tera type and moves. Export them as Showdown pastes that import cleanly.
3. **Strategy write-ups.** Explain why each member is on the team, its role, its threats and counters, the game plan, and how to play key matchups.
4. **Draft-run videos.** Render any team as a vertical (9:16) "Pokémon draft run" short in the style of Gen 2 team-builder TikToks: a 6-slot Pokéball grid filling in one pick at a time, with Gym Leader / TM / Pokédex cards popping up between reveals.

**Core principle:** facts come from data, judgment comes from the planner. Legality, stats, learnsets, availability and damage numbers are always computed from real data and validated in code. Never let the LLM (or a hardcoded guess) be the source of truth for any of them.

## Stack

- **TypeScript** (strict), Node 20+, pnpm workspaces
- **@pkmn/dex, @pkmn/data**: species, moves, abilities, items and learnsets for every generation
- **@pkmn/sets**: parse and export Showdown pastes
- **@pkmn/sim**: `TeamValidator` for format legality, and the battle sim for test battles
- **@smogon/calc**: damage calculations
- **Smogon data**: sets from `data.pkmn.cc/sets/<format>.json`, usage stats via `@pkmn/smogon` / smogon.com/stats (fetched and cached, never live at runtime)
- **PokeAPI**: encounter locations per game version, species flavor data (genus, height, weight) and sprites. Fetched once and cached.
- **Anthropic API** (optional planner layer): team concepts, role assignment, write-ups. The model is configured in `.env` (`ANTHROPIC_MODEL`), never hardcoded.
- **Voiceover (free, local by default):** **Kokoro** (Apache 2.0, runs on CPU) for speech, **faster-whisper** for word timings. Both are Python, so they live in a small sidecar in `tools/voice/` (managed with `uv`) that the TS code calls through a JSON stdin/stdout protocol. **ElevenLabs** is an optional paid engine behind the same interface. **Piper** is the fastest draft engine.
- **Remotion** (React) for video rendering; ffmpeg bundled
- **zod** for every schema at a boundary (run files, team files, cache files, LLM output)
- **vitest** for tests

## Commands

```bash
pnpm install
pnpm data:sync                       # fetch + cache pkmn/Smogon/PokeAPI data into data/cache/
pnpm data:sync --only encounters     # partial sync

# In-game teams
pnpm team ingame --game crystal --style balanced            # → teams/crystal-<id>.json + .md
pnpm team ingame --game emerald --must swampert --no-trades
pnpm team ingame --game platinum --nuzlocke                 # use first-encounter rules

# Competitive teams
pnpm team showdown --format gen9ou --archetype "hyper offense"
pnpm team showdown --format gen9ou --core "great tusk,gholdengo"
pnpm team validate teams/my-team.txt --format gen9ou        # TeamValidator, exits non-zero on errors
pnpm team calc teams/my-team.txt --vs threats/gen9ou-top30  # key damage calcs → markdown

# One command: anything in → video out (see "Make: team in, video out")
pnpm make --paste teams/my-showdown.txt --format gen9ou
pnpm make --game crystal --team "typhlosion, ampharos, gyarados, heracross, umbreon, dragonite"
pnpm make --game crystal "Johto-only team with Feraligatr, no legendaries, beats Red"
pnpm make --random --game crystal                         # random team → video (seed printed so it can be reproduced)
pnpm make --random --game crystal --mode draft --seed 42  # draft-style: pick 1 of 3 random options each slot
pnpm make --random --format gen9ou --mode chaos           # fully random legal team, no quality filter
pnpm make --batch 5 --random --game crystal               # five random videos, seeds recorded in each run JSON
pnpm make ... --review            # stop after the script so you can edit lines, then: pnpm make --resume <id>

# Write-ups and video
pnpm team explain teams/crystal-abc.json                    # strategy write-up (markdown)
pnpm video from-team teams/crystal-abc.json                 # team → run JSON for the video
pnpm voice setup                                            # uv sync the Python sidecar, download Kokoro + whisper models
pnpm voice script runs/crystal-abc.json                     # write narration lines into the run (review/edit them)
pnpm voice lint runs/crystal-abc.json                       # check length, estimated duration, unsupported claims
pnpm voice generate runs/crystal-abc.json                   # Kokoro → audio, faster-whisper → word timings, manifest
pnpm voice generate runs/crystal-abc.json --voice am_michael --speed 1.1
pnpm voice generate runs/crystal-abc.json --engine elevenlabs --dry-run   # paid engine: show character count first
pnpm voice generate runs/crystal-abc.json --engine piper    # fastest draft voice
pnpm voice preview runs/crystal-abc.json                    # concat all lines into one wav to listen to the pacing
pnpm video dev                                              # Remotion Studio
pnpm video render runs/crystal-abc.json                     # → out/<id>.mp4

pnpm typecheck && pnpm lint && pnpm test
```

## Layout

```
packages/
  core/                     # pure logic, no I/O except through data/
    src/
      data/                 # typed loaders over data/cache/ (gen-aware Dex, availability, usage)
      games/                # one config per game: version group, gen, dex, gyms, bosses, level caps, rules
        crystal.ts
        emerald.ts
        ...
      ingame/
        availability.ts     # what's catchable/obtainable when (by badge count), incl. trades, gifts, evolutions
        planner.ts          # pick 6 under constraints; type coverage vs the game's bosses
        bosses.ts           # strategy per gym leader / E4 / rival using damage calcs
      competitive/
        sets.ts             # choose sets (Smogon sets + usage as priors)
        builder.ts          # cores, roles, archetypes, team-wide checks
        threats.ts          # top-usage threat list per format; who checks what
        validate.ts         # wraps @pkmn/sim TeamValidator
      analysis/
        coverage.ts         # offensive/defensive type charts (gen-correct!)
        roles.ts            # hazard setter, removal, pivot, wincon, speed control, …
        calc.ts             # wrappers over @smogon/calc
      llm/
        planner.ts          # optional: ask the model for concepts/roles/write-ups
        schemas.ts          # zod schemas for every LLM response
      export/
        showdown.ts         # Team → paste (via @pkmn/sets)
        markdown.ts         # Team + analysis → write-up
        run.ts              # Team → video run JSON
        script.ts           # Team + analysis → narration lines per beat
      voice/
        engine.ts           # TtsEngine interface: synthesize(text, opts) → { audioPath, durationMs }
        kokoro.ts           # default: calls the Python sidecar
        elevenlabs.ts       # optional paid engine
        piper.ts            # draft engine
        align.ts            # word timings: whisper words → matched back onto the script's words
        cache.ts            # content-addressed cache so the same line is never synthesized twice
        pronounce.ts        # applies data/curated/pronunciations.json before synthesis
      script/
        facts.ts            # team + analysis → list of citable facts per pick (id, text, kind)
        templates.ts        # deterministic line templates (no API key needed)
        writer.ts           # optional LLM writer: may only use the facts it's given
        lint.ts             # length, duration estimate, fact-reference checks
      types.ts              # Team, Member, Set, Game, Run, …
  cli/                      # `pnpm team ...` and `pnpm data:sync` entrypoints, thin wrappers over core
tools/
  voice/                    # Python sidecar (uv): kokoro_tts.py, align_whisper.py, one JSON request → one JSON response
  video/                    # Remotion project (see "Video" below)
data/
  cache/                    # synced data (gitignored)
  curated/                  # hand-maintained: gym leader rosters per game, boss teams, notes
teams/                      # generated teams (json + .txt paste + .md)
runs/                       # video run files
out/                        # rendered videos (gitignored)
```

`core` must not import from `video` or `cli`. `video` only consumes run JSON, never `core` internals.

## Data rules (important)

- **Always think in generations.** Type charts, abilities, physical/special split (gen 1–3 is by type), stats (gen 1 Special), items, EV/DV systems and move learnsets all differ by gen. Every lookup goes through a gen-specific `Dex`: `Dex.forGen(n)` / `new Generations(Dex).get(n)`. A gen 2 team must never see Fairy type, abilities or natures.
- **Availability is per version, not per generation.** Crystal ≠ Gold ≠ Silver. Track version exclusives, Pokémon only available after N badges, gift and trade Pokémon, evolution methods (trade evolutions need `--no-trades` handling), and items or TMs needed to make a set work in-game.
- Every learned move is checked against the learnset for that game's version group, including the source (level-up level, TM/HM, tutor, egg). In-game plans must say *when* the move is learned.
- Competitive teams must pass `TeamValidator` for the target format before they're written to disk. A failed validation is a hard error, never a warning.
- Curated data (gym rosters, boss teams, level caps) lives in `data/curated/` as typed JSON validated with zod, with a source note per file. When something isn't in PokeAPI or pkmn, add it here; don't hardcode it in logic.
- `data:sync` throttles requests and skips anything already cached. Nothing at render or build time hits the network.

## Planner rules

- The planner works in this order: **candidates from data → constraints filter → scoring → (optional) LLM picks concept and roles → code builds sets → validation → calcs → write-up.**
- In-game scoring considers: availability timing (earlier is better), matchups against that game's actual gym and boss rosters, type coverage, movepool quality *in that game*, stat totals, and redundancy. Avoid six teammates that share a weakness.
- Competitive scoring considers: role coverage (hazards, removal, speed control, pivoting, a win condition), checks to the format's top threats (backed by calcs), defensive synergy, and archetype fit.
- LLM output is always parsed with zod. Anything it claims (a set, a move, an item) is re-checked against data; if invalid, either repair it in code or retry with the error. Never pass LLM text straight into a paste.
- The planner must work end to end **without** an API key (deterministic heuristics). The LLM layer only improves concepts and write-ups.
- Randomness (e.g. `--random`, draft modes) is always seeded: use `--seed` if given, otherwise generate one, print it and store it, so the same command reproduces the same team.

## Output formats

- **Team JSON** (`teams/<id>.json`): the canonical format. Game or format, members with full sets, roles, in-game acquisition plan, analysis results. Zod schema in `core/types.ts`.
- **Showdown paste** (`teams/<id>.txt`): produced only via `@pkmn/sets` export, and it must round-trip: parse(export(team)) deep-equals team.
- **Write-up** (`teams/<id>.md`):
  - In-game: team overview → per-member "where/when to get it, what to teach it" → boss-by-boss strategy with leads and key calcs → items/TMs checklist.
  - Competitive: team concept → per-member set + role + reasoning → threat list with answers → leads and game plan → notable calcs (quote them in standard `@smogon/calc` description format).
- **Video run** (`runs/<id>.json`): see "Video".

## Video

Remotion project in `packages/video`. It turns one run JSON into one MP4.

### Run file schema

```jsonc
{
  "id": "johto-run-01",
  "title": "Building a Johto team",
  "music": "audio/route29.mp3",
  "voiceover": {
    "hook": "Can a Johto team with no legendaries beat Red?",   // plays over the empty grid
    "outro": "Would you run this team? Drop yours below."
  },
  "picks": [
    { "pokemon": "meganium",
      "intro": { "kind": "gymLeader", "name": "Morty", "sprite": "leaders/morty.png", "types": ["ghost"] },
      "line": { "text": "Morty's ghosts wall half of Johto, so we start with Meganium.", "factIds": ["meganium.vs-morty"] },
      "effect": null },
    { "pokemon": "ampharos", "intro": { "kind": "tm", "move": "thunder-wave", "number": 45 }, "effect": "lightning" },
    { "pokemon": "dragonair", "intro": { "kind": "pokedex" } }
  ]
}
```

`export/run.ts` derives intros from the team: the gym leader that a pick counters, the TM it relies on, or its Pokédex entry. A run file can still be hand-written.

### Spec

- 1080×1920 @ 30fps. About 8–12 seconds per pick, about 60–75 seconds total. Keep everything 64px or more inside the bottom and right edges so the TikTok UI doesn't cover it.
- Beat for each pick: grid idle → dim/blur grid → card pops in (spring, slight overshoot) → hold → card exits → background shifts to the pick's type color → Pokéball in slot N opens → Pokémon + name/type plate → short hold.
- Pixel font everywhere. Sprites use `image-rendering: pixelated` and integer scaling only. Type and card colors live in `theme.ts` only.
- Cards: Pokédex = red, Gym Leader = gold, TM = green. Rounded corners, thick border, inner white panel, small header label.

### Remotion rules

- **Rendering is deterministic.** No `Math.random()`, `Date.now()` or fetches in components. Use `random(seed)` from `remotion` and read assets only via `staticFile()`.
- All animation is driven by `useCurrentFrame()` + `interpolate` / `spring`. No CSS transitions or keyframe animations.
- Timing lives in `timeline.ts`, a pure function of (run, fps, voice manifest?) → beats. `durationInFrames` is derived from it, never hardcoded.
- When a voice manifest exists, narration drives timing (see "Script and timing"). Without one, use the default beat lengths from `theme.ts`.
- Duck the music under narration with Remotion's per-frame `volume` callback (about −12 dB while a line is playing, with 150ms ramps).
- Captions are word-by-word, built from the manifest's word timings, in the pixel font, above the bottom safe zone. Show 2–4 words at a time and highlight the current word. Captions show the original script text, never the pronunciation respellings.
- Check visual changes in Studio, then render a short range (`--frames=0-300`) instead of the whole video.

## Script and timing

The order is always **script → audio → timing → render**. Audio is generated first and measured; the video is timed to the audio, never the other way around.

### 1. Facts (`script/facts.ts`)

Before any line is written, build a list of citable facts per pick from the team JSON and analysis, each with an ID:

```jsonc
{ "id": "meganium.vs-morty", "kind": "matchup",  "text": "Meganium takes neutral damage from Morty's Ghost moves and walls Haunter" }
{ "id": "meganium.razorleaf", "kind": "move",    "text": "learns Razor Leaf by level-up at level N" }
{ "id": "ampharos.calc1",    "kind": "calc",     "text": "Thunderpunch 2HKOs Jasmine's Skarmory" }
```

(Illustrative: real fact text and numbers are generated from data.) Facts only come from data and calcs. This is the only material a line is allowed to use.

### 2. Lines (`script/templates.ts`, `script/writer.ts`)

- **Template writer (default, no API key):** picks the strongest 1–2 facts per pick (priority: boss matchup > calc > key move > availability) and fills varied templates (e.g. "{leader} is a problem, so {pokemon} — {fact}."). Use `random(seed)` to vary templates, never `Math.random()`.
- **LLM writer (optional, `--llm`):** gets the facts list and must return zod-validated JSON: `{ key, text, factIds[] }` per line. Any line citing an unknown fact ID, or naming a Pokémon/move/number that isn't in its cited facts, is rejected and regenerated.
- Every line is stored in the run JSON with its `factIds`, so you can always see why a claim is there.

**Structure:**
| Part | Length | Purpose |
|---|---|---|
| Hook | ≤ 12 words, ~2–3 s | the question or challenge, over the empty grid |
| Pick lines (×6) | 12–25 words, ~4–9 s each | why this pick, using 1–2 facts |
| Outro | ≤ 12 words | call to comment / follow |

Write for the ear: say the Pokémon's name in the first half of its line (the reveal lands on it), no stat abbreviations, no move-slot lists, numbers rounded unless they're the point.

### 3. Lint (`script/lint.ts`)

`voice lint` fails the run (non-zero exit) if:
- a line is over its word limit, or the estimated duration (words ÷ ~2.7 words/s at speed 1.0) puts the total outside 55–80 s
- a pick line doesn't contain its Pokémon's name
- a line has no `factIds`, or cites facts that don't exist
- a word has no pronunciation entry and isn't in the English dictionary (warn, so you can add a respelling)

### 4. Audio (`voice/` + `tools/voice/`)

- Synthesize **one file per line** (`public/voice/<run-id>/<key>.wav`) so editing one line only regenerates one file.
- Kokoro config (voice, speed, lang) comes from `.env` / CLI flags: `KOKORO_VOICE`, `KOKORO_SPEED`. Default speed 1.05–1.15 for TikTok pacing.
- Pronunciation respellings (`data/curated/pronunciations.json`, e.g. `"ampharos": "AMP-fair-oss"`) are applied to the TTS text only. Kokoro uses espeak-ng for phonemes (`pacman -S espeak-ng`), and also accepts inline phoneme overrides for names that respelling can't fix.
- Trim leading/trailing silence from each file, then record exact `durationMs`.
- **Cache key = hash(engine, model, voice, speed, text after pronunciation).** Re-running on an unchanged run does zero synthesis.

### 5. Word timings (`voice/align.ts`)

- Run faster-whisper (`small.en` or `base.en`, int8, CPU) with `word_timestamps=True` on each line's audio.
- **Never use Whisper's text for captions.** Match Whisper's words back onto the known script words (normalize case/punctuation, fuzzy match with edit distance). Pokémon names often come back misheard ("am pharos"), so:
  - match against the respelled TTS text, then map back to the original word
  - any script word left unmatched gets its time interpolated between its matched neighbors, proportional to character length
- Output per line: `[{ word, startMs, endMs }]` using the script's words. ElevenLabs (if used) supplies its own timestamps and skips Whisper.
- Write `public/voice/<run-id>/manifest.json`: `{ key, file, durationMs, words[] }` per line. Validate with zod.

### 6. Timeline (`video/src/timeline.ts`)

Pure function: `(run, fps, manifest?) → beats[]`, all in frames.

```
[hook line ............][gap]
[pick 1: line ...........................][hold][gap]
        ^ card in at line start
                    ^ ball opens on the first frame of the Pokémon's name (from words[])
                         ^ name/type plate 6 frames later
...
[outro line ......][end hold]
```

Rules:
- **Beat length = max(line duration + 0.6 s hold, minimum visual time).** The minimum visual time (card in → hold → exit → ball opens → plate) is ~3.5 s, so short lines don't rush the animation.
- **Anchors from word timings:** card pops in at line start; card exits ~0.3 s before the Pokémon's name; Pokéball opens on the name's first frame; effects (lightning, etc.) start on the same frame as the ball.
- If the name isn't found in `words[]` (shouldn't happen after lint), fall back to 55% through the line.
- Gaps between lines: 0.25 s. Music runs continuously; the voice doesn't.
- All values are rounded to whole frames once, in `timeline.ts`; components never do timing math.
- `durationInFrames` = end of last beat + end hold.

## Make: team in, video out

`pnpm make` (and Claude Code itself, when asked in chat) turns whatever the user gives into a finished video. It runs the same pipeline as the separate commands; it doesn't have its own logic.

### Accepted input
1. **Showdown paste** (file or stdin) + `--format`: parsed with `@pkmn/sets`.
2. **A list of Pokémon** + `--game` or `--format`: names are normalized with `toID` and fuzzy-matched ("ampharose" → ampharos; ask if ambiguous). Missing sets are filled in: in-game by the planner's movepool/acquisition logic, competitive from Smogon sets.
3. **A description** ("Crystal team with Feraligatr, no legendaries"): turned into planner constraints (`--must`, `--ban`, style, game/format) and built by the planner. Parse the constraints with the LLM if available, or ask for them as flags without a key.
4. **Partial mixes** ("my team is X, Y, Z, fill the rest"): the given members are locked, the planner fills the remaining slots.

### Steps
```
input → team JSON → validate/availability check → analysis + calcs → facts
      → script → lint → [--review stop] → voice → manifest → timeline → render
```
Writes `teams/<id>.json|.txt|.md`, `runs/<id>.json`, `public/voice/<id>/` and `out/<id>.mp4`. Each step is cached, so `--resume` after editing the script only redoes voice (for changed lines) and render.

### Random teams
Three modes, all seeded. Without `--seed`, pick one, print it and store it in the team and run JSON so any video can be regenerated exactly.
- **`--mode draft` (default):** for each of the 6 slots, roll 3 candidates from the game's obtainable pool (or the format's legal pool), filtered so a pick never duplicates an earlier type weakness or role. The planner picks the best of the 3 for the team so far. The video shows this: the card for each pick can be a "pick 1 of 3" reveal, and the script mentions the alternatives ("Over Sudowoodo and Stantler, we take Ampharos").
- **`--mode random`:** the whole team is random within constraints (obtainable, legal, no duplicate species, at most 2 sharing a weakness), and then built properly: real sets, real strategy.
- **`--mode chaos`:** any legal team, no quality filter. The script is honest that it's a challenge run.

Random teams accept the same constraints as everything else: `--must`, `--ban`, `--no-legendaries`, `--no-trades`, `--mono <type>`, `--dex johto`. The rest of the pipeline is identical: analysis → facts → script → voice → video.

### User teams are the user's
- **Never silently change a team the user gave.** If something is illegal for the format, unobtainable in that game, or a move can't be learned there, stop and report exactly what and why, with a suggested fix. Continue only with `--fix` (apply suggestions) or `--as-is` (keep it; for in-game, the video and write-up say how it's obtained, e.g. "trade from Gold").
- Weak or odd picks are fine; that's the user's call. The script presents the team's real strengths and can be honest about its weaknesses ("no answer to Lance's Dragonite, so we'll lean on Ice Beam"), but it never mocks the team.
- The intro card for each pick still comes from data: the boss it handles best, its key TM, or its Pokédex entry.

### When the user asks Claude Code directly in chat
For "make a video of this team: …", "do a Crystal run with Feraligatr", or a pasted team:
1. Work out the input type and game/format. If the game or format is missing and can't be inferred, ask once.
2. Run `pnpm make ... --review`.
3. Show the user the team summary (and any validation problems) and the script lines, and ask for changes.
4. Apply edits to the run JSON, `pnpm make --resume <id>`, then report the path to the MP4 and the total duration.

## Testing

- Unit tests for coverage math per gen (e.g. Ghost doesn't hit Psychic super-effectively in gen 1, Steel resists Ghost/Dark in gens 2–5 only).
- Golden tests: known-legal and known-illegal pastes per format through `validate.ts`.
- Availability tests per game config (e.g. in Crystal, Larvitar is only available at Mt. Silver after the E4; Gligar is catchable in Gold and Crystal but not Silver). Write the expected values from the data, not from memory.
- Round-trip test for Showdown export.
- Random: the same seed + flags produce the identical team and run JSON; every random team passes validation/availability; draft mode never offers an unobtainable candidate.
- Make: each input type (paste, name list, description, partial) on fixtures reaches a valid run JSON; an illegal paste stops with a clear report and does not modify the team.
- Planner smoke test: `team ingame --game crystal --seed 1` and `team showdown --format gen9ou --seed 1` produce valid output with no API key set.
- `timeline.ts` tests: total duration and that beats don't overlap, both with and without a voice manifest.
- Voice: cache hit/miss with a mocked engine (no real TTS or API calls in tests); `align.ts` with misheard names and dropped words; pronunciation applied to TTS text but not captions.
- Script: lint catches long lines, missing names and unknown fact IDs; the template writer is deterministic for a given seed.
- Timeline: anchors land on the right frames for a fixture manifest; short lines still get the minimum visual time.

## Conventions

- TypeScript strict, functional style, no default exports except the Remotion root. One component/module per file.
- Normalize every name to the pkmn ID format (`toID`) internally, and only use display names at output.
- Adding a new game = one config in `core/games/` + curated boss data. No planner code changes. If you find yourself special-casing a game in logic, move that to config.
- Adding a new format = it should just work through @pkmn data + synced Smogon sets/usage. If it doesn't, fix the data layer.
- Commit `teams/` and `runs/` you want to keep. Never commit `data/cache/`, `out/`, `public/voice/`, model files or `.env`.

## IP note

Pokémon names, sprites and characters are Nintendo/Game Freak IP. This is fan content: don't present anything as official, don't scrape or bundle ripped game assets beyond what PokeAPI serves, and keep this in mind before monetizing the videos.

## Voice licensing

- Kokoro is Apache 2.0: fine for monetized videos, no attribution required. Use its stock voices.
- ElevenLabs (optional): free-plan output is non-commercial and needs attribution; commercial use needs a paid plan, covering only audio generated while subscribed.
- Only use voices you're allowed to use. Never clone someone else's voice (anime voice actors, streamers, etc.).
