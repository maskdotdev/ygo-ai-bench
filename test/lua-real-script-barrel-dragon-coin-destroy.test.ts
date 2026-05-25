import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const barrelCode = "81480460";
const targetCode = "814804600";
const hasBarrelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${barrelCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasBarrelScript)("Lua real script Barrel Dragon coin destroy", () => {
  it("restores opponent-monster targeted three-coin ignition into destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${barrelCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [barrelCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const barrel = requireCard(session, barrelCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, barrel, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(barrelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === barrel.uid).map((effect) => ({
      category: effect.category,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryCoin | categoryDestroy, event: "ignition", property: 16, range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === barrel.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: barrel.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === barrel.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "coinTossed", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: barrel.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: barrel.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Barrel Dragon");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(1-tp) end");
  expect(script).toContain("Duel.IsExistingTarget(nil,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,nil,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("local heads=Duel.CountHeads(Duel.TossCoin(tp,3))");
  expect(script).toContain("if heads<2 then return end");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: barrelCode, name: "Barrel Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2600, defense: 2200 },
    { code: targetCode, name: "Barrel Dragon Destroy Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
