import fs from "node:fs";
import path from "node:path";
import { createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createLuaScriptHost, type LuaInitialEffectRegistrationResult } from "#lua/host.js";
import { parseYdk } from "#playtest/ydk.js";

interface ProbeArgs {
  ydkPath: string;
  upstreamRoot: string;
}

const args = readArgs(process.argv.slice(2));
const ydkText = fs.readFileSync(args.ydkPath, "utf8");
const deck = parseYdk(ydkText);
const deckCodes = unique([...deck.main, ...deck.extra]);
const upstream = createUpstreamNodeWorkspace(createUpstreamSourceConfig(args.upstreamRoot));
const databaseCards = upstream.readDatabaseCards("cards.cdb");
const cards = mergeProbeCards(deck.main, deck.extra, databaseCards);
const session = createDuel({ seed: 1, startingHandSize: 5, cardReader: createCardReader(cards) });

loadDecks(session, {
  0: { main: deck.main, extra: deck.extra },
  1: { main: [], extra: [] },
});
startDuel(session);

const host = createLuaScriptHost(session, upstream);
const scriptResults = deckCodes.map((code) => {
  const name = `c${code}.lua`;
  const found = findScript(upstream, name);
  const card = cards.find((candidate) => candidate.code === code);
  const expectedMissing = !found && isScriptlessNormalMonster(card);
  const load = found ? host.loadCardScript(code, upstream) : { ok: true };
  return { code, name, foundAt: found?.path, source: found?.source, isStub: found?.isStub ?? false, expectedMissing, load };
});

const initialEffectResults = host.registerInitialEffectsDetailed();

const actions = getLegalActions(session, 0);

printReport({
  ydkPath: args.ydkPath,
  upstreamRoot: args.upstreamRoot,
  metadataSource: databaseCards.length ? "cards.cdb" : "placeholder",
  scriptResults,
  initialEffectResults,
  registeredEffectCount: session.state.effects.length,
  actions,
});

function readArgs(argv: string[]): ProbeArgs {
  const upstreamFlag = argv.indexOf("--upstream");
  const upstreamRoot = upstreamFlag >= 0 ? argv[upstreamFlag + 1] : ".upstream/ignis";
  const positional = argv.filter((value, index) => (upstreamFlag < 0 || (index !== upstreamFlag && index !== upstreamFlag + 1)) && !value.startsWith("--"));
  const ydkPath = positional[0];
  if (!ydkPath || !upstreamRoot) {
    console.error("Usage: npm run probe:lua-deck -- <deck.ydk> [--upstream .upstream/ignis]");
    process.exit(1);
  }
  return { ydkPath: path.resolve(ydkPath), upstreamRoot: path.resolve(upstreamRoot) };
}

function mergeProbeCards(main: string[], extra: string[], databaseCards: DuelCardData[]): DuelCardData[] {
  if (!databaseCards.length) return createPlaceholderCards(main, extra);
  const extraCodes = new Set(extra);
  const byCode = new Map(databaseCards.map((card) => [card.code, card]));
  return unique([...main, ...extra]).map((code) => {
    const card = byCode.get(code);
    if (!card) return createPlaceholderCard(code, extraCodes);
    return extraCodes.has(code) ? { ...card, kind: "extra" } : card;
  });
}

function createPlaceholderCards(main: string[], extra: string[]): DuelCardData[] {
  const extraCodes = new Set(extra);
  return unique([...main, ...extra]).map((code) => createPlaceholderCard(code, extraCodes));
}

function createPlaceholderCard(code: string, extraCodes: Set<string>): DuelCardData {
  return {
    code,
    name: `Card ${code}`,
    kind: extraCodes.has(code) ? "extra" : "monster",
  };
}

function findScript(upstream: ReturnType<typeof createUpstreamNodeWorkspace>, name: string): { path: string; source: string; isStub: boolean } | undefined {
  for (const candidate of upstream.scriptCandidates(name)) {
    if (fs.existsSync(candidate.path)) {
      return {
        path: candidate.path,
        source: candidate.source,
        isStub: candidate.source === "local-fallback" && fs.readFileSync(candidate.path, "utf8").includes("local-fallback-stub"),
      };
    }
  }
  return undefined;
}

function printReport(report: {
  ydkPath: string;
  upstreamRoot: string;
  metadataSource: string;
  scriptResults: Array<{ code: string; name: string; foundAt: string | undefined; source: string | undefined; isStub: boolean; expectedMissing: boolean; load: { ok: boolean; error?: string } }>;
  initialEffectResults: LuaInitialEffectRegistrationResult[];
  registeredEffectCount: number;
  actions: DuelAction[];
}): void {
  const found = report.scriptResults.filter((result) => result.foundAt);
  const upstreamFound = found.filter((result) => result.source !== "local-fallback" && result.source !== "local-override");
  const localOverrides = found.filter((result) => result.source === "local-override");
  const localFallbacks = found.filter((result) => result.source === "local-fallback");
  const localFallbackStubs = localFallbacks.filter((result) => result.isStub);
  const expectedMissing = report.scriptResults.filter((result) => !result.foundAt && result.expectedMissing);
  const missing = report.scriptResults.filter((result) => !result.foundAt && !result.expectedMissing);
  const loadErrors = report.scriptResults.filter((result) => !result.load.ok);
  const initialFailures = report.initialEffectResults.filter((result) => !result.ok);
  const registeredInitialEffects = report.initialEffectResults.filter((result) => result.ok && !result.skipped).length;

  console.log(`Lua deck probe: ${path.basename(report.ydkPath)}`);
  console.log(`Upstream root: ${report.upstreamRoot}`);
  console.log(`Metadata source: ${report.metadataSource}`);
  console.log("");
  console.log(`Scripts found: ${found.length}`);
  for (const result of found) console.log(`  ${scriptStatusLabel(result)} ${result.name} -> ${displayScriptPath(report.upstreamRoot, result)}`);
  console.log(`Upstream scripts found: ${upstreamFound.length}`);
  console.log(`Local overrides: ${localOverrides.length}`);
  for (const result of localOverrides) console.log(`  OVERRIDE ${result.name} -> ${path.relative(process.cwd(), result.foundAt!)}`);
  console.log(`Local fallback scripts: ${localFallbacks.length}`);
  for (const result of localFallbacks) {
    const status = result.isStub ? "STUB" : "FALLBACK";
    console.log(`  ${status} ${result.name} -> ${path.relative(process.cwd(), result.foundAt!)}`);
  }
  console.log(`Local fallback stubs: ${localFallbackStubs.length}`);
  console.log(`Scripts missing: ${missing.length}`);
  for (const result of missing) console.log(`  MISSING ${result.name}`);
  console.log(`Scripts not expected: ${expectedMissing.length}`);
  for (const result of expectedMissing) console.log(`  NO SCRIPT ${result.name}`);
  console.log("");
  console.log(`Script load errors: ${loadErrors.length}`);
  for (const result of loadErrors) console.log(`  ERROR ${result.name}: ${result.load.error ?? "unknown error"}`);
  console.log("");
  console.log(`Registered initial_effect calls: ${registeredInitialEffects}`);
  console.log(`Initial effect failures: ${initialFailures.length}`);
  for (const result of initialFailures) console.log(`  ERROR c${result.code}.lua (${result.uid}): ${result.error ?? "unknown error"}`);
  console.log(`Registered Lua effects: ${report.registeredEffectCount}`);
  console.log(`First failing API/helper: ${firstFailingApi([...initialFailures.map((result) => result.error), ...loadErrors.map((result) => result.load.error)]) ?? "none detected"}`);
  printFailureGroups([...initialFailures.map((result) => result.error), ...loadErrors.map((result) => result.load.error)]);
  console.log("");
  console.log(`Opening hand legal actions: ${report.actions.length}`);
  for (const action of report.actions) console.log(`  ${action.type}: ${action.label}`);
}

function scriptStatusLabel(result: { source: string | undefined; isStub: boolean }): string {
  if (result.source === "local-fallback" && result.isStub) return "STUB";
  if (result.source === "local-fallback") return "FALLBACK";
  if (result.source === "local-override") return "OVERRIDE";
  return "OK";
}

function displayScriptPath(upstreamRoot: string, result: { foundAt: string | undefined; source: string | undefined }): string {
  if (!result.foundAt) return "";
  const relativeRoot = result.source === "local-fallback" || result.source === "local-override" ? process.cwd() : upstreamRoot;
  return path.relative(relativeRoot, result.foundAt);
}

function firstFailingApi(errors: Array<string | undefined>): string | undefined {
  for (const error of errors) {
    const match = error?.match(/(?:global|field) '([^']+)'|attempt to call .* '([^']+)'|attempt to index .* '([^']+)'/);
    const name = match?.[1] ?? match?.[2] ?? match?.[3];
    if (name) return name;
  }
  return errors.find(Boolean);
}

function printFailureGroups(errors: Array<string | undefined>): void {
  const groups = new Map<string, number>();
  for (const error of errors) {
    const key = classifyFailure(error);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  console.log("Failure groups:");
  if (!groups.size) {
    console.log("  none");
    return;
  }
  for (const [key, count] of groups) console.log(`  ${key}: ${count}`);
}

function classifyFailure(error: string | undefined): string {
  if (!error) return "unknown";
  if (error.includes("was not found")) return "missing scripts";
  if (/global '([^']+)'/.test(error)) return "missing globals/constants";
  if (/field '([^']+)'/.test(error)) {
    const field = /field '([^']+)'/.exec(error)?.[1] ?? "";
    if (field.startsWith("aux.") || error.includes("aux")) return "missing aux.* helpers";
    if (error.includes("Card") || /^[A-Z]/.test(field)) return "missing Card.* APIs";
    if (error.includes("Duel")) return "missing Duel.* APIs";
  }
  if (error.includes("initial_effect")) return "semantic failures during initial_effect";
  return "semantic failures during initial_effect";
}

function isScriptlessNormalMonster(card: DuelCardData | undefined): boolean {
  const typeFlags = card?.typeFlags;
  if (typeFlags === undefined) return false;
  const isMonster = (typeFlags & 0x1) !== 0;
  const isNormal = (typeFlags & 0x10) !== 0;
  const hasScriptBearingType = (typeFlags & (
    0x2 | // spell
    0x4 | // trap
    0x20 | // effect
    0x40 | // fusion
    0x80 | // ritual
    0x2000 | // synchro
    0x800000 | // xyz
    0x1000000 | // pendulum
    0x4000000 // link
  )) !== 0;
  return isMonster && isNormal && !hasScriptBearingType;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
