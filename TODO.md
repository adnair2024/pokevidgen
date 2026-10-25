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
- [ ] `core/data`: gen-aware loaders (`Dex.forGen(n)`, `Generations`), `toID` helpers
- [ ] `data:sync`: PokeAPI encounters per version (throttled, skips cached), species flavor data, sprites
- [ ] `data:sync`: Smogon sets and usage per format (`--only` partial sync)
- [ ] zod schemas for every cache file
- [ ] Tests: gen-correct lookups (no Fairy/abilities/natures in gen 2)

## M2: Game configs and curated data (Gen 1: Red and Blue; Yellow deferred, Green dropped)
- [ ] `games/red.ts`, `games/blue.ts`: shared gen 1 version group, per-version dex and rules (Yellow later = one more config)
- [ ] `data/curated/<game>/`: gym leader, Elite Four, rival and Giovanni rosters (zod, with source notes)
- [ ] `ingame/availability.ts`: obtainable by badge count, gifts, trades, evolutions, version exclusives
- [ ] Gen 1 rules in config: Special stat, DVs, no abilities or items, type-based split
- [ ] Availability tests with expected values taken from synced data (Red vs Blue version exclusives)

## M3: Analysis
- [ ] `analysis/coverage.ts`: gen-correct type charts (gen 1 Ghost/Psychic, Steel in gens 2-5)
- [ ] `analysis/calc.ts`: `@smogon/calc` wrappers
- [ ] `analysis/roles.ts`: role detection
- [ ] Per-gen coverage tests (gen 1: Ghost vs Psychic, Special)

## M4: In-game planner
- [ ] Candidates, then constraint filter (`--must`, `--ban`, `--no-trades`, `--no-legendaries`, `--nuzlocke`)
- [ ] Scoring: timing, boss matchups, coverage, movepool in that game, redundancy
- [ ] Move legality and "learned when" from version-group learnsets
- [ ] `ingame/bosses.ts`: strategy per leader using calcs
- [ ] `pnpm team ingame --game red --seed 1` works with no API key

## M5: Exporters
- [ ] `export/showdown.ts` via `@pkmn/sets`, with round-trip test
- [ ] `export/markdown.ts` write-up (in-game layout)
- [ ] `pnpm team explain`

## M6: Competitive builder
- [ ] `competitive/validate.ts` wrapping `TeamValidator` (hard error on failure)
- [ ] `sets.ts`, `threats.ts`, `builder.ts`
- [ ] `pnpm team showdown --format gen9ou --seed 1`, `validate` and `calc` commands
- [ ] Golden tests: known-legal and known-illegal pastes

## M7: Facts, script, lint
- [ ] `script/facts.ts`: citable facts with IDs from team and calcs
- [ ] `script/templates.ts`: seeded template writer
- [ ] `script/lint.ts`: word limits, duration estimate, name and fact checks
- [ ] `export/run.ts`: Team to run JSON, with derived intro cards

## M8: Video (no voice)
- [ ] Remotion project in `packages/video`, `theme.ts`, pixel font
- [ ] `timeline.ts` (pure) with tests, with and without a manifest
- [ ] Grid, ball-open, Pokemon plate and the three card types
- [ ] Render a short range, check the safe zones

## M9: Voice
- [ ] `tools/voice/` Python sidecar (uv): Kokoro and faster-whisper, JSON protocol
- [ ] `voice/` engine interface, cache, pronunciations, `align.ts`
- [ ] Manifest, then timeline anchors, ducking and word-by-word captions
- [ ] Mocked-engine tests for cache and alignment

## M10: `pnpm make` and random
- [ ] Input parsing: paste, name list, description, partial teams (fuzzy name matching)
- [ ] `--review` / `--resume`, `--fix` / `--as-is`
- [ ] Seeded `--random` with draft, random and chaos modes, `--batch`

## M11: Optional LLM layer
- [ ] `llm/planner.ts` and `schemas.ts`, with zod and re-checking against data
- [ ] `--llm` script writer restricted to the supplied facts

## Needs a decision
- [ ] Install `uv` (Python sidecar) and run `espeak-ng` setup checks before M9
- [ ] Pick which games and formats to support after Gen 1 (and a first competitive format, e.g. gen1ou or gen9ou)
