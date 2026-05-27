# YGO Bench

Engine-backed Yu-Gi-Oh benchmark MVP.

This app contains both the deterministic mock benchmark suite and the real `ocgcore-wasm` path backed by local Project Ignis card data/scripts. The mock suite is used for tactical benchmark coverage and oracle validation; the real suite proves the engine-backed legal-action loop, trace artifacts, viewer output, and data pinning.

## Commands

```sh
pnpm --filter @ygo-bench/app build
pnpm --filter @ygo-bench/app bench smoke
pnpm --filter @ygo-bench/app bench real-smoke
pnpm --filter @ygo-bench/app bench real-run --scenario scenarios/real/smoke-duel.json --agent greedy --viewer
pnpm --filter @ygo-bench/app bench real-run --scenario scenarios/real/smoke-duel.json --agent openai --viewer
pnpm --filter @ygo-bench/app bench real-eval --agents random,greedy --runs 1 --viewer
pnpm --filter @ygo-bench/app bench real-validate suites/real-mvp.json
pnpm --filter @ygo-bench/app bench run scenarios/lethal/lethal-001.json --agent random --viewer
pnpm --filter @ygo-bench/app bench eval suites/mvp.json --agents random,greedy,llm --viewer
pnpm --filter @ygo-bench/app bench validate suites/mvp.json
pnpm --filter @ygo-bench/app bench serve-trace benchmark-runs/<run>/trace.jsonl --port 4173
```

Run artifacts are written to `apps/ygo-bench/benchmark-runs/`.

`real-smoke` uses `@n1xx1/ocgcore-wasm` with local Project Ignis exports from `../../.upstream/ignis/script` and `../../public/card-data/cdb-rows.json`.

Use `--agent openai` with either the mock scenario harness or `real-run` by setting `OPENAI_API_KEY`. The model defaults to `gpt-4o-mini`; override with `YGO_BENCH_OPENAI_MODEL`.

`serve-trace` serves a local browser viewer and streams the selected `trace.jsonl` over WebSocket at `/trace`. It can replay an existing trace and will broadcast appended lines when the trace file grows.
