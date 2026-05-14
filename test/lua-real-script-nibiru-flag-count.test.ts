import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import type { DuelCardData, DuelCardInstance } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nibiru flag counts", () => {
  it("stacks summon-count flags so Nibiru becomes legal after five opponent summons", () => {
    const belowThreshold = createNibiruSession(4);
    expect(nibiruActions(belowThreshold.session, belowThreshold.nibiru)).toHaveLength(0);
    const restoredBelowThreshold = restoreDuelWithLuaScripts(serializeDuel(belowThreshold.session), belowThreshold.workspace, belowThreshold.reader);
    expect(restoredBelowThreshold.restoreComplete, restoredBelowThreshold.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBelowThreshold.missingRegistryKeys).toEqual([]);
    expect(restoredBelowThreshold.session.state.flagEffects.filter((flag) => flag.code === Number(belowThreshold.nibiru.code))).toHaveLength(4);
    expect(nibiruRestoreActions(restoredBelowThreshold, belowThreshold.nibiru)).toHaveLength(0);

    const atThreshold = createNibiruSession(5);
    expect(nibiruActions(atThreshold.session, atThreshold.nibiru)).toHaveLength(1);
    const restoredAtThreshold = restoreDuelWithLuaScripts(serializeDuel(atThreshold.session), atThreshold.workspace, atThreshold.reader);
    expect(restoredAtThreshold.restoreComplete, restoredAtThreshold.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAtThreshold.missingRegistryKeys).toEqual([]);
    expect(restoredAtThreshold.session.state.flagEffects.filter((flag) => flag.code === Number(atThreshold.nibiru.code))).toHaveLength(5);
    expect(nibiruRestoreActions(restoredAtThreshold, atThreshold.nibiru)).toHaveLength(1);
  });
});

function createNibiruSession(flagCount: number): { session: ReturnType<typeof createDuel>; nibiru: DuelCardInstance; reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> } {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const nibiruCode = "27204311";
  const tokenCode = "27204312";
  const fieldCodes = ["10000021", "10000022"];
  const databaseCards = workspace.readDatabaseCards("cards.cdb").filter((card) => [nibiruCode, tokenCode].includes(card.code));
  const fieldCards: DuelCardData[] = [
    { code: fieldCodes[0]!, name: "Release Body A", kind: "monster", typeFlags: 0x21, attack: 1200, defense: 1000 },
    { code: fieldCodes[1]!, name: "Release Body B", kind: "monster", typeFlags: 0x21, attack: 800, defense: 2000 },
  ];
  const reader = createCardReader([...databaseCards, ...fieldCards]);
  const session = createDuel({ seed: 295 + flagCount, startingHandSize: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [nibiruCode, fieldCodes[0]!] }, 1: { main: [fieldCodes[1]!] } });
  startDuel(session);

  const nibiru = requireCard(session, nibiruCode, 0);
  const bodyA = requireCard(session, fieldCodes[0]!, 0);
  const bodyB = requireCard(session, fieldCodes[1]!, 1);
  moveDuelCard(session.state, nibiru.uid, "hand", 0);
  moveFaceUpMonster(session, bodyA);
  moveFaceUpMonster(session, bodyB);

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(nibiruCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const flags = host.loadScript(registerNibiruFlags(flagCount), `nibiru-flags-${flagCount}.lua`);
  expect(flags.ok, flags.error).toBe(true);
  return { session, nibiru, reader, workspace };
}

function requireCard(session: ReturnType<typeof createDuel>, code: string, controller: 0 | 1): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.controller === controller);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpMonster(session: ReturnType<typeof createDuel>, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function nibiruActions(session: ReturnType<typeof createDuel>, nibiru: DuelCardInstance) {
  return getDuelLegalActions(session, 0).filter((action) => action.type === "activateEffect" && action.uid === nibiru.uid);
}

function nibiruRestoreActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, nibiru: DuelCardInstance) {
  return getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateEffect" && action.uid === nibiru.uid);
}

function registerNibiruFlags(count: number): string {
  return Array.from({ length: count }, () => "Duel.RegisterFlagEffect(1, 27204311, RESET_PHASE|PHASE_END, 0, 1)").join("\n");
}
