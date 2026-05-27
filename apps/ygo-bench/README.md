# YGO Bench

Engine-backed Yu-Gi-Oh benchmark scaffold.

This first app is intentionally dependency-light. It implements the benchmark harness shape from `docs/ygo-bench-mvp-plan.md` with a deterministic mock engine adapter, so the CLI, agents, scoring, trace writer, hidden-info filter, and viewer artifact can be exercised before `ocgcore-wasm` and Project Ignis data are wired in.

## Commands

```sh
pnpm --filter @ygo-bench/app build
pnpm --filter @ygo-bench/app bench smoke
pnpm --filter @ygo-bench/app bench run scenarios/lethal/lethal-001.json --agent random --viewer
pnpm --filter @ygo-bench/app bench eval suites/mvp.json --agents random,greedy,llm --viewer
```

Run artifacts are written to `apps/ygo-bench/benchmark-runs/`.
