import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const racePlant = 0x400;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rose Witch double tribute", () => {
  it("restores EFFECT_DOUBLE_TRIBUTE race predicates for the tribute summon target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const roseWitchCode = "23087070";
    const plantTributeTargetCode = "23087071";
    const warriorTributeTargetCode = "23087072";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === roseWitchCode),
      { code: plantTributeTargetCode, name: "Rose Witch Plant Tribute Target", kind: "monster" as const, typeFlags: 0x1, race: racePlant, level: 7, attack: 2400, defense: 1000 },
      { code: warriorTributeTargetCode, name: "Rose Witch Warrior Tribute Decoy", kind: "monster" as const, typeFlags: 0x1, race: raceWarrior, level: 7, attack: 2400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2308, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [roseWitchCode, plantTributeTargetCode, warriorTributeTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const roseWitch = session.state.cards.find((card) => card.code === roseWitchCode);
    const plantTributeTarget = session.state.cards.find((card) => card.code === plantTributeTargetCode);
    const warriorTributeTarget = session.state.cards.find((card) => card.code === warriorTributeTargetCode);
    expect(roseWitch).toBeDefined();
    expect(plantTributeTarget).toBeDefined();
    expect(warriorTributeTarget).toBeDefined();
    const script = workspace.readScript(`c${roseWitchCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_DOUBLE_TRIBUTE)");
    expect(script).toContain("return c:IsRace(RACE_PLANT)");
    moveDuelCard(session.state, roseWitch!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, plantTributeTarget!.uid, "hand", 0);
    moveDuelCard(session.state, warriorTributeTarget!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(roseWitchCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === roseWitch!.uid && effect.code === 150)?.event).toBe("continuous");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const plantAction = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === plantTributeTarget!.uid && action.tributeUids.length === 1 && action.tributeUids[0] === roseWitch!.uid,
    );
    expect(plantAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(getLuaRestoreLegalActions(restored, 0).some(
      (action) => action.type === "tributeSummon" && action.uid === warriorTributeTarget!.uid && action.tributeUids.length === 1 && action.tributeUids[0] === roseWitch!.uid,
    )).toBe(false);

    applyLuaRestoreAndAssert(restored, plantAction!);

    expect(restored.session.state.cards.find((card) => card.uid === plantTributeTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "tribute",
      summonMaterialUids: [roseWitch!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === roseWitch!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.summon,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === warriorTributeTarget!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === roseWitch!.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: roseWitch!.uid,
        eventReason: duelReason.release | duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: plantTributeTarget!.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  if (result.state.waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, result.state.waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, result.state.waitingFor));
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
