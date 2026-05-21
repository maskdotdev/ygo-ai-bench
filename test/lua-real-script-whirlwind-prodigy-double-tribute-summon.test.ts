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
const whirlwindProdigyCode = "15090429";
const hasWhirlwindProdigyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${whirlwindProdigyCode}.lua`));
const windTributeTargetCode = "150904290";
const fireTributeTargetCode = "150904291";
const typeMonster = 0x1;
const attributeWind = 0x8;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasWhirlwindProdigyScript)("Lua real script Whirlwind Prodigy double tribute", () => {
  it("restores EFFECT_DOUBLE_TRIBUTE WIND attribute predicates for the tribute summon target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${whirlwindProdigyCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE)");
    expect(script).toContain("e1:SetCode(EFFECT_DOUBLE_TRIBUTE)");
    expect(script).toContain("e1:SetValue(s.condition)");
    expect(script).toContain("return c:IsAttribute(ATTRIBUTE_WIND)");

    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === whirlwindProdigyCode),
      { code: windTributeTargetCode, name: "Whirlwind Prodigy WIND Tribute Target", kind: "monster" as const, typeFlags: typeMonster, attribute: attributeWind, level: 7, attack: 2400, defense: 1000 },
      { code: fireTributeTargetCode, name: "Whirlwind Prodigy FIRE Tribute Decoy", kind: "monster" as const, typeFlags: typeMonster, attribute: attributeFire, level: 7, attack: 2400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 15090429, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [whirlwindProdigyCode, windTributeTargetCode, fireTributeTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const prodigy = session.state.cards.find((card) => card.code === whirlwindProdigyCode);
    const windTributeTarget = session.state.cards.find((card) => card.code === windTributeTargetCode);
    const fireTributeTarget = session.state.cards.find((card) => card.code === fireTributeTargetCode);
    expect(prodigy).toBeDefined();
    expect(windTributeTarget).toBeDefined();
    expect(fireTributeTarget).toBeDefined();
    moveDuelCard(session.state, prodigy!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, windTributeTarget!.uid, "hand", 0);
    moveDuelCard(session.state, fireTributeTarget!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(whirlwindProdigyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === prodigy!.uid && effect.code === 150)).toEqual(
      expect.objectContaining({
        event: "continuous",
        code: 150,
        sourceUid: prodigy!.uid,
        registryKey: `lua:${whirlwindProdigyCode}:lua-1-150`,
      }),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const windAction = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === windTributeTarget!.uid && action.tributeUids.length === 1 && action.tributeUids[0] === prodigy!.uid,
    );
    expect(windAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(getLuaRestoreLegalActions(restored, 0).some(
      (action) => action.type === "tributeSummon" && action.uid === fireTributeTarget!.uid && action.tributeUids.length === 1 && action.tributeUids[0] === prodigy!.uid,
    )).toBe(false);

    applyLuaRestoreAndAssert(restored, windAction!);

    expect(restored.session.state.cards.find((card) => card.uid === windTributeTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "tribute",
      summonMaterialUids: [prodigy!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === prodigy!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.summon,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === fireTributeTarget!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === prodigy!.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: prodigy!.uid,
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
        eventCardUid: windTributeTarget!.uid,
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
