import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const chateauHuyukCode = "50260683";
const materialCode = "502606830";
const releaseCostCode = "502606831";
const targetCode = "502606832";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChateauHuyukScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chateauHuyukCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setChronomaly = 0x70;

describe.skipIf(!hasUpstreamScripts || !hasChateauHuyukScript)("Lua real script Number 36 Chateau Huyuk detach release destroy stat", () => {
  it("restores detach final ATK zero into ReleaseCheckTarget cost destruction of the changed target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chateauHuyukCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 50260683, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, releaseCostCode], extra: [chateauHuyukCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const chateauHuyuk = requireCard(session, chateauHuyukCode);
    const material = requireCard(session, materialCode);
    const releaseCost = requireCard(session, releaseCostCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, chateauHuyuk, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    chateauHuyuk.overlayUids.push(material.uid);
    moveFaceUpAttack(session, releaseCost, 0);
    releaseCost.sequence = 1;
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chateauHuyukCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattleOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredBattleOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === chateauHuyuk.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleOpen, attack!);
    passBattleAction(restoredBattleOpen, 1, "passAttack");
    passBattleAction(restoredBattleOpen, 0, "passAttack");
    expect(restoredBattleOpen.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 1 });
    passBattleAction(restoredBattleOpen, 1, "passDamage");

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredBattleOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const statActivation = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateEffect" && action.uid === chateauHuyuk.uid);
    expect(statActivation, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, statActivation!);
    passRestoredChain(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: chateauHuyuk.uid,
      reasonEffectId: 2,
    });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === chateauHuyuk.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === target.uid), restoredBattle.session.state)).toBe(0);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 0 },
    ]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    restoredBattle.session.state.phase = "main2";
    restoredBattle.session.state.waitingFor = 0;
    delete restoredBattle.session.state.battleStep;
    delete restoredBattle.session.state.battleWindow;
    delete restoredBattle.session.state.currentAttack;
    delete restoredBattle.session.state.pendingBattle;
    const restoredDestroyOpen = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDestroyOpen);
    expectRestoredLegalActions(restoredDestroyOpen, 0);
    const destroyActivation = getLuaRestoreLegalActions(restoredDestroyOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === chateauHuyuk.uid && action.effectId.endsWith("-3")
    );
    expect(destroyActivation, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyOpen, destroyActivation!);
    passRestoredChain(restoredDestroyOpen);

    expect(restoredDestroyOpen.session.state.cards.find((card) => card.uid === chateauHuyuk.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: chateauHuyuk.uid,
      reasonEffectId: 3,
    });
    expect(restoredDestroyOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: chateauHuyuk.uid,
      reasonEffectId: 3,
    });
    expect(restoredDestroyOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "released", "destroyed"].includes(event.eventName)).map((event) => ({
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
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: chateauHuyuk.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: chateauHuyuk.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: chateauHuyuk.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: target.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: chateauHuyuk.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_CHRONOMALY),4,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,aux.ReleaseCheckTarget,nil,dg)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,aux.ReleaseCheckTarget,nil,dg)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter2,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: chateauHuyukCode, name: "Number 36: Chronomaly Chateau Huyuk", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeLight, setcodes: [setChronomaly], level: 4, attack: 2000, defense: 2500 },
    { code: materialCode, name: "Chateau Huyuk Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, setcodes: [setChronomaly], level: 4, attack: 1000, defense: 1000 },
    { code: releaseCostCode, name: "Chateau Huyuk Chronomaly Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, setcodes: [setChronomaly], level: 4, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Chateau Huyuk Changed Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2400, defense: 1000 },
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

function passBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
