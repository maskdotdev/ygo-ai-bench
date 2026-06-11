# YGO Bench

Engine-backed Yu-Gi-Oh benchmark MVP.

This app contains the real `ocgcore-wasm` MVP benchmark suite backed by local Project Ignis card data/scripts. `suites/mvp.json` is the canonical engine-backed suite. `suites/mock-mvp.json` is retained only for fast harness regression tests.

## Commands

```sh
pnpm --filter @ygo-bench/app build
pnpm --filter @ygo-bench/app bench smoke
pnpm --filter @ygo-bench/app bench real-smoke
pnpm --filter @ygo-bench/app bench real-run --scenario scenarios/real/smoke-duel.json --agent greedy --viewer
pnpm --filter @ygo-bench/app bench real-run --scenario scenarios/real/smoke-duel.json --agent openai --viewer
pnpm --filter @ygo-bench/app bench real-eval --agents random,greedy --runs 1 --viewer
pnpm --filter @ygo-bench/app bench real-eval --suite suites/long-horizon-v1.json --competitors greedy,random,openai:gpt-4o-mini --runs 1
pnpm --filter @ygo-bench/app bench real-validate suites/mvp.json
pnpm --filter @ygo-bench/app bench real-validate suites/long-horizon-v1.json
pnpm --filter @ygo-bench/app bench run scenarios/lethal/lethal-001.json --agent random --viewer
pnpm --filter @ygo-bench/app bench eval suites/mvp.json --agents random,greedy,llm --viewer
pnpm --filter @ygo-bench/app bench validate suites/mvp.json
pnpm --filter @ygo-bench/app bench serve-trace benchmark-runs/<run>/trace.jsonl --port 4173
pnpm --filter @ygo-bench/app bench ui
```

Run artifacts are written to `apps/ygo-bench/benchmark-runs/`.

The real engine path uses `@n1xx1/ocgcore-wasm` with local Project Ignis exports from `../../.upstream/ignis/script` and `../../public/card-data/cdb-rows.json`. Override those defaults with `YGO_BENCH_SCRIPT_ROOT` and `YGO_BENCH_CARD_DATA`.

Use `--agent openai` or `--agent llm` by setting `OPENAI_API_KEY`. The model defaults to `gpt-4o-mini`; override with `YGO_BENCH_OPENAI_MODEL` or `--model`.

`suites/long-horizon-v1.json` is the first long-term strategy suite. It is meant to compare model planning quality across multi-turn setup/payoff, resource-grind, interruption-baiting, delayed-lethal, recovery, and defensive-planning scenarios. Use `--competitors` when comparing model variants through the same wrapper, for example `openai:gpt-4o-mini,openai:gpt-4.1,greedy`. Summary rows group by competitor ID rather than only by agent wrapper.

The UI command serves Replay, Eval, and Play workspaces. Eval mode can launch a long-horizon benchmark from the browser, stream progress, show a component-score leaderboard, and link completed runs back into replay traces.

`serve-trace` serves a local browser viewer and streams the selected `trace.jsonl` over WebSocket at `/trace`. It can replay an existing trace and will broadcast appended lines when the trace file grows.

Every real run writes `trace.jsonl`, `final-score.json`, `model-transcript.md`, `engine-messages.bin`, `reduced-state.json`, and `metadata.json`; `--viewer` also writes `viewer.html`. Metadata records the ocgcore-wasm version, core version, card-data hash, script repository commit when available, LFList repository commit when available, banlist hash when present, and scenario hash.
