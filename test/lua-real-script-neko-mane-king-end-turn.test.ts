import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Neko Mane King turn-ending skips", () => {
  it("restores its official opponent Battle Phase lock with skipped phases", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nekoCode = "11021521";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nekoCode),
      { code: "11021522", name: "Neko Mane King filler", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1102, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nekoCode] }, 1: { main: [] } });
    startDuel(session);

    const neko = requireCard(session, nekoCode);
    moveDuelCard(session.state, neko.uid, "monsterZone", 0);
    neko.faceUp = true;
    neko.position = "faceUpAttack";
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nekoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const sent = host.loadScript(
      `
      local neko=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${nekoCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("neko sent " .. Duel.SendtoGrave(neko,REASON_EFFECT))
      `,
      "neko-send-to-grave.lua",
    );
    expect(sent.ok, sent.error).toBe(true);
    expect(host.messages).toContain("neko sent 1");
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: neko.uid, eventName: "sentToGraveyard", eventCode: 1014, player: 0 })]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === neko.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger.session, trigger);
    passChainUntilOpen(restoredTrigger.session);
    expect(restoredTrigger.session.state.skippedPhases).toEqual([
      { player: 1, phase: "draw", remaining: 1 },
      { player: 1, phase: "standby", remaining: 1 },
      { player: 1, phase: "main1", remaining: 1 },
      { player: 1, phase: "battle", remaining: 1 },
      { player: 1, phase: "main2", remaining: 1 },
    ]);
    expect(restoredTrigger.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: neko.uid, event: "continuous", code: 185, targetRange: [0, 1], reset: { flags: 0x40000200 } })]),
    );

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    const actions = getLuaRestoreLegalActions(restoredLock, 1);
    expect(actions).toEqual(getDuelLegalActions(restoredLock.session, 1));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "endTurn", player: 1 })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "main2" })]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passChainUntilOpen(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    applyRestoredActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "passChain"));
  }
}

function applyRestoredActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
