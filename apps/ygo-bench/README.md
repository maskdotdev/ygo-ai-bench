# YGO Bench

Engine-backed Yu-Gi-Oh benchmark scaffold.

This first app is intentionally dependency-light. It implements the benchmark harness shape from `docs/ygo-bench-mvp-plan.md` with a deterministic mock engine adapter, so the CLI, agents, scoring, trace writer, hidden-info filter, and viewer artifact can be exercised before `ocgcore-wasm` and Project Ignis data are wired in.

## Commands

```sh
pnpm --filter @ygo-bench/app build
pnpm --filter @ygo-bench/app bench smoke
pnpm --filter @ygo-bench/app bench real-smoke
pnpm --filter @ygo-bench/app bench real-run --scenario scenarios/real/smoke-duel.json --agent greedy --viewer
pnpm --filter @ygo-bench/app bench real-eval --agents random,greedy --runs 1 --viewer
pnpm --filter @ygo-bench/app bench real-validate suites/real-mvp.json
pnpm --filter @ygo-bench/app bench run scenarios/lethal/lethal-001.json --agent random --viewer
pnpm --filter @ygo-bench/app bench eval suites/mvp.json --agents random,greedy,llm --viewer
pnpm --filter @ygo-bench/app bench validate suites/mvp.json
```

Run artifacts are written to `apps/ygo-bench/benchmark-runs/`.

`real-smoke` uses `@n1xx1/ocgcore-wasm` with local Project Ignis exports from `../../.upstream/ignis/script` and `../../public/card-data/cdb-rows.json`.

Use `--agent openai` with the mock scenario harness by setting `OPENAI_API_KEY`. The model defaults to `gpt-4o-mini`; override with `YGO_BENCH_OPENAI_MODEL`.
