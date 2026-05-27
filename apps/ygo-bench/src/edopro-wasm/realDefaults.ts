export const DEFAULT_CARD_DATA_PATH = "../../public/card-data/cdb-rows.json";
export const DEFAULT_SCRIPT_ROOT = "../../.upstream/ignis/script";
export const DEFAULT_REAL_SUITE_PATH = "suites/mvp.json";
export const LEGACY_REAL_SUITE_PATH = "suites/real-mvp.json";

export function cardDataPathFromEnv(): string {
  return process.env.YGO_BENCH_CARD_DATA ?? DEFAULT_CARD_DATA_PATH;
}

export function scriptRootFromEnv(): string {
  return process.env.YGO_BENCH_SCRIPT_ROOT ?? DEFAULT_SCRIPT_ROOT;
}
