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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kaiser Sea Horse double tribute", () => {
  it("restores EFFECT_DOUBLE_TRIBUTE value predicates for the tribute summon target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kaiserCode = "17444133";
    const lightTributeTargetCode = "601053";
    const darkTributeTargetCode = "601054";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kaiserCode),
      { code: lightTributeTargetCode, name: "Kaiser LIGHT Tribute Target", kind: "monster" as const, typeFlags: 0x1, attribute: 0x10, level: 7, attack: 2400, defense: 1000 },
      { code: darkTributeTargetCode, name: "Kaiser DARK Tribute Decoy", kind: "monster" as const, typeFlags: 0x1, attribute: 0x20, level: 7, attack: 2400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1744, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kaiserCode, lightTributeTargetCode, darkTributeTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const kaiser = session.state.cards.find((card) => card.code === kaiserCode);
    const lightTributeTarget = session.state.cards.find((card) => card.code === lightTributeTargetCode);
    const darkTributeTarget = session.state.cards.find((card) => card.code === darkTributeTargetCode);
    expect(kaiser).toBeDefined();
    expect(lightTributeTarget).toBeDefined();
    expect(darkTributeTarget).toBeDefined();
    moveDuelCard(session.state, kaiser!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, lightTributeTarget!.uid, "hand", 0);
    moveDuelCard(session.state, darkTributeTarget!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kaiserCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === kaiser!.uid && effect.code === 150)?.event).toBe("continuous");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const lightAction = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === lightTributeTarget!.uid && action.tributeUids.length === 1 && action.tributeUids[0] === kaiser!.uid,
    );
    expect(lightAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(getLuaRestoreLegalActions(restored, 0).some(
      (action) => action.type === "tributeSummon" && action.uid === darkTributeTarget!.uid && action.tributeUids.length === 1 && action.tributeUids[0] === kaiser!.uid,
    )).toBe(false);

    applyLuaRestoreAndAssert(restored, lightAction!);

    expect(restored.session.state.cards.find((card) => card.uid === lightTributeTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "tribute",
      summonMaterialUids: [kaiser!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === kaiser!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.summon,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === darkTributeTarget!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === kaiser!.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: kaiser!.uid,
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
        eventCardUid: lightTributeTarget!.uid,
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
