import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Artifact Lancea banish lock", () => {
  it("restores official temporary EFFECT_CANNOT_REMOVE and blocks banish helpers until End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lanceaCode = "34267821";
    const selfBanishCode = "900000265";
    const opponentBanishCode = "900000266";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lanceaCode),
      { code: selfBanishCode, name: "Lancea Self Banish Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentBanishCode, name: "Lancea Opponent Banish Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 342, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [selfBanishCode] }, 1: { main: [lanceaCode, opponentBanishCode] } });
    startDuel(session);

    const lancea = session.state.cards.find((card) => card.code === lanceaCode);
    const selfBanish = session.state.cards.find((card) => card.code === selfBanishCode);
    const opponentBanish = session.state.cards.find((card) => card.code === opponentBanishCode);
    expect(lancea).toBeDefined();
    expect(selfBanish).toBeDefined();
    expect(opponentBanish).toBeDefined();
    moveDuelCard(session.state, lancea!.uid, "hand", 1);
    moveDuelCard(session.state, selfBanish!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentBanish!.uid, "graveyard", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lanceaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const lanceaAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === lancea!.uid);
    expect(lanceaAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, lanceaAction!);
    resolveOpenChain(session);
    expect(session.state.cards.find((card) => card.uid === lancea!.uid)).toMatchObject({ location: "graveyard", controller: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    assertBanishProbe(restored, selfBanishCode, opponentBanishCode, "locked", [
      "lancea self able remove locked false",
      "lancea opp able remove locked false",
      "lancea self remove locked 0/0",
      "lancea opp remove locked 0/0",
    ]);

    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const endTurn = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyLuaRestoreResponse(restored, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
    assertBanishProbe(restored, selfBanishCode, opponentBanishCode, "after end", [
      "lancea self able remove after end true",
      "lancea opp able remove after end true",
      "lancea self remove after end 1/1",
      "lancea opp remove after end 1/1",
    ]);
  });
});

function resolveOpenChain(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.chain.length > 0; index += 1) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
  expect(session.state.chain).toHaveLength(0);
}

function assertBanishProbe(restored: LuaSnapshotRestoreResult, selfBanishCode: string, opponentBanishCode: string, label: string, expected: string[]): void {
  const result = restored.host.loadScript(
    `
    local self_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${selfBanishCode}),0,LOCATION_GRAVE,0,1,1,nil):GetFirst()
    local opponent_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${opponentBanishCode}),0,0,LOCATION_GRAVE,1,1,nil):GetFirst()
    Debug.Message("lancea self able remove ${label} " .. tostring(self_card:IsAbleToRemove()))
    Debug.Message("lancea opp able remove ${label} " .. tostring(opponent_card:IsAbleToRemove()))
    Debug.Message("lancea self remove ${label} " .. Duel.Remove(self_card,POS_FACEUP,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
    Debug.Message("lancea opp remove ${label} " .. Duel.Remove(opponent_card,POS_FACEUP,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
    `,
    `lancea-${label.replace(/\\s+/g, "-")}-probe.lua`,
  );
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages).toEqual(expect.arrayContaining(expected));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  return response;
}
