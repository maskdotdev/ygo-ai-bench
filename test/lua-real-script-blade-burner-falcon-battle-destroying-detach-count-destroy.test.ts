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
const falconCode = "96592102";
const materialACode = "965921020";
const materialBCode = "965921024";
const battleTargetCode = "965921021";
const destroyTargetACode = "965921022";
const destroyTargetBCode = "965921023";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFalconScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${falconCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWingedBeast = 0x80;
const attributeDark = 0x20;
const attributeWind = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasFalconScript)("Lua real script Blade Burner Falcon battle destroying detach count destroy", () => {
  it("restores battle-destroying detach cost label into exact opponent monster destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${falconCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 96592102, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [falconCode] }, 1: { main: [battleTargetCode, destroyTargetACode, destroyTargetBCode] } });
    startDuel(session);

    const falcon = requireCard(session, falconCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const destroyTargetA = requireCard(session, destroyTargetACode);
    const destroyTargetB = requireCard(session, destroyTargetBCode);
    moveFaceUpAttack(session, falcon, 0);
    moveDuelCard(session.state, materialA.uid, "overlay", 0).sequence = 0;
    moveDuelCard(session.state, materialB.uid, "overlay", 0).sequence = 1;
    falcon.overlayUids.push(materialA.uid, materialB.uid);
    moveFaceUpAttack(session, battleTarget, 1);
    moveFaceUpAttack(session, destroyTargetA, 1);
    moveFaceUpAttack(session, destroyTargetB, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(falconCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === falcon.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattleUntilTrigger(restoredBattle);

    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-3-1139",
        eventCardUid: falcon.uid,
        eventCode: 1139,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDestroyed",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: falcon.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: falcon.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === falcon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect("operationInfos" in trigger!).toBe(false);
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === falcon.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: falcon.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: falcon.uid,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === destroyTargetA.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: falcon.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === destroyTargetB.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      reason: 0,
    });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: falcon.uid,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.battle,
        eventReasonCardUid: falcon.uid,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
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
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "battleDestroyed", "detachedMaterial"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: battleTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: battleTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyTargetA.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_WINGEDBEAST),4,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetLP(1-tp)>=Duel.GetLP(tp)+3000");
  expect(script).toContain("c:UpdateAttack(3000)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e2:SetCondition(aux.bdocon)");
  expect(script).toContain("Cost.DetachFromSelf(1,function(e,tp) return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end,function(e,og) e:SetLabel(#og) end)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,e:GetLabel(),tp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,0,LOCATION_MZONE,ct,ct,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: falconCode, name: "Raidraptor - Blade Burner Falcon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: materialACode, name: "Blade Burner Falcon Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 800, defense: 800 },
    { code: materialBCode, name: "Blade Burner Falcon Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 800, defense: 800 },
    { code: battleTargetCode, name: "Blade Burner Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 500, defense: 500 },
    { code: destroyTargetACode, name: "Blade Burner Destroy Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1600, defense: 1000 },
    { code: destroyTargetBCode, name: "Blade Burner Destroy Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1700, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
