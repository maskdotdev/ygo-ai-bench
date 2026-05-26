import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const liebeCode = "26096328";
const materialACode = "260963280";
const materialBCode = "260963281";
const allyCode = "260963282";
const firstTargetCode = "260963283";
const secondTargetCode = "260963284";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLiebeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${liebeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasLiebeScript)("Lua real script Juggernaut Liebe detach stat attack lock", () => {
  it("restores detach-cost self stat boost, other-monster attack lock, and overlay-count extra monster attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${liebeCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,11,3,s.ovfilter,aux.Stringid(id,0),3,s.xyzop)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e0:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e0:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
    expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,2),nil)");
    expect(script).toContain("e2:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
    expect(script).toContain("return math.max(0,oc)");

    const cards: DuelCardData[] = [
      { code: liebeCode, name: "Superdreadnought Rail Cannon Juggernaut Liebe", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceMachine, level: 11, attack: 4000, defense: 4000 },
      { code: materialACode, name: "Liebe Overlay Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 10, attack: 1000, defense: 1000 },
      { code: materialBCode, name: "Liebe Overlay Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 10, attack: 1000, defense: 1000 },
      { code: allyCode, name: "Liebe Locked Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1800, defense: 1000 },
      { code: firstTargetCode, name: "Liebe First Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: secondTargetCode, name: "Liebe Second Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 26096328, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, allyCode], extra: [liebeCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const liebe = requireCard(session, liebeCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const ally = requireCard(session, allyCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    moveFaceUpAttack(session, liebe, 0);
    moveDuelCard(session.state, materialA.uid, "overlay", 0);
    moveDuelCard(session.state, materialB.uid, "overlay", 0);
    liebe.overlayUids.push(materialA.uid, materialB.uid);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, firstTarget, 1);
    moveFaceUpAttack(session, secondTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(liebeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === liebe.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    const state = restoredBoost.session.state;
    expect(state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: liebe.uid,
      reasonEffectId: 2,
    });
    expect(state.cards.find((card) => card.uid === liebe.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(currentAttack(state.cards.find((card) => card.uid === liebe.uid)!, state)).toBe(6000);
    expect(currentDefense(state.cards.find((card) => card.uid === liebe.uid)!, state)).toBe(6000);
    expect(state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(state.effects.filter((effect) => effect.sourceUid === liebe.uid && [85, 100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: undefined, reset: { flags: 33492992 }, targetRange: undefined, value: 2000 },
      { code: 104, event: "continuous", property: undefined, reset: { flags: 33492992 }, targetRange: undefined, value: 2000 },
      { code: 85, event: "continuous", property: 0x80, reset: { flags: 1073742336 }, targetRange: [4, 0], value: undefined },
    ]);
    expect(state.eventHistory.filter((event) => event.eventName === "detachedMaterial" && event.eventCardUid === materialA.uid)).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: materialA.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: liebe.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.waitingFor = 0;
    const battleActions = getLuaRestoreLegalActions(restoredBoost, 0);
    expect(hasAttack(battleActions, liebe.uid, firstTarget.uid), JSON.stringify(battleActions, null, 2)).toBe(true);
    expect(hasAttack(battleActions, liebe.uid, secondTarget.uid)).toBe(true);
    expect(hasDirectAttack(battleActions, liebe.uid)).toBe(false);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === ally.uid)).toBe(false);

    const firstAttack = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === liebe.uid && action.targetUid === firstTarget.uid);
    expect(firstAttack, JSON.stringify(battleActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, firstAttack!);
    passBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 5000 });
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: liebe.uid,
        eventPlayer: 1,
        eventValue: 5000,
        eventReason: duelReason.battle,
        eventReasonCardUid: liebe.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredBoost.session), workspace, reader);
    expectCleanRestore(restoredSecondAttack);
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    expect(hasAttack(secondActions, liebe.uid, firstTarget.uid)).toBe(false);
    expect(hasAttack(secondActions, liebe.uid, secondTarget.uid)).toBe(true);
    expect(secondActions.some((action) => action.type === "declareAttack" && action.attackerUid === ally.uid)).toBe(false);
    const secondAttack = secondActions.find((action) => action.type === "declareAttack" && action.attackerUid === liebe.uid && action.targetUid === secondTarget.uid);
    expect(secondAttack, JSON.stringify(secondActions, null, 2)).toBeDefined();
    expect(restoredSecondAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 5000 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true && action.targetUid === undefined);
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
