import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Earthshattering Event deck grave lock", () => {
  it("restores its deck-to-GY trigger and temporary EFFECT_CANNOT_TO_GRAVE lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const earthshatteringCode = "54407825";
    const sentFromDeckCode = "900000269";
    const lockedSelfCode = "900000270";
    const lockedOpponentCode = "900000271";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === earthshatteringCode),
      { code: sentFromDeckCode, name: "Earthshattering Sent From Deck", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: lockedSelfCode, name: "Earthshattering Self Locked Mill", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: lockedOpponentCode, name: "Earthshattering Opponent Locked Mill", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 544, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [earthshatteringCode, sentFromDeckCode, lockedSelfCode] }, 1: { main: [lockedOpponentCode] } });
    startDuel(session);

    const earthshattering = session.state.cards.find((card) => card.code === earthshatteringCode);
    expect(earthshattering).toBeDefined();
    moveDuelCard(session.state, earthshattering!.uid, "spellTrapZone", 0);
    earthshattering!.position = "faceUpAttack";
    earthshattering!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(earthshatteringCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const mill = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${sentFromDeckCode}),0,LOCATION_DECK,0,1,1,nil):GetFirst()
      Debug.Message("earthshattering initial mill " .. Duel.SendtoGrave(c,REASON_EFFECT))
      `,
      "earthshattering-initial-mill.lua",
    );
    expect(mill.ok, mill.error).toBe(true);
    expect(host.messages).toContain("earthshattering initial mill 1");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === earthshattering!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(activated.ok, activated.error).toBe(true);
    resolveOpenChain(restoredTrigger);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    assertDeckGraveLock(restoredLock, lockedSelfCode, lockedOpponentCode, "locked", [
      "earthshattering self able grave locked false",
      "earthshattering opp able grave locked false",
      "earthshattering self grave locked 0/0",
      "earthshattering opp grave locked 0/0",
    ]);

    const endTurn = getLuaRestoreLegalActions(restoredLock, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyLuaRestoreResponse(restoredLock, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
    assertDeckGraveLock(restoredLock, lockedSelfCode, lockedOpponentCode, "after end", [
      "earthshattering self able grave after end true",
      "earthshattering opp able grave after end true",
      "earthshattering self grave after end 1/1",
      "earthshattering opp grave after end 1/1",
    ]);
  });
});

function resolveOpenChain(restored: LuaSnapshotRestoreResult): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
  }
  expect(restored.session.state.chain).toHaveLength(0);
}

function assertDeckGraveLock(restored: LuaSnapshotRestoreResult, lockedSelfCode: string, lockedOpponentCode: string, label: string, expected: string[]): void {
  const result = restored.host.loadScript(
    `
    local self_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${lockedSelfCode}),0,LOCATION_DECK,0,1,1,nil):GetFirst()
    local opponent_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${lockedOpponentCode}),0,0,LOCATION_DECK,1,1,nil):GetFirst()
    Debug.Message("earthshattering self able grave ${label} " .. tostring(self_card:IsAbleToGrave()))
    Debug.Message("earthshattering opp able grave ${label} " .. tostring(opponent_card:IsAbleToGrave()))
    Debug.Message("earthshattering self grave ${label} " .. Duel.SendtoGrave(self_card,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
    Debug.Message("earthshattering opp grave ${label} " .. Duel.SendtoGrave(opponent_card,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
    `,
    `earthshattering-${label.replace(/\\s+/g, "-")}-probe.lua`,
  );
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages).toEqual(expect.arrayContaining(expected));
}
