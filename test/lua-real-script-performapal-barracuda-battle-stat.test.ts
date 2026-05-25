import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const barracudaCode = "92767273";
const attackerCode = "927672730";
const defenderCode = "927672731";
const performapalTargetCode = "927672732";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBarracudaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${barracudaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFish = 0x1000000;
const attributeEarth = 0x10;
const setPerformapal = 0x9f;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBarracudaScript)("Lua real script Performapal Barracuda battle stat", () => {
  it("restores PZONE battle-confirm ATK loss using opponent current/base ATK difference", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${barracudaCode}.lua`);
    expect(script).toContain("--Performapal Barracuda");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_CONFIRM)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("local bc1,bc2=Duel.GetBattleMonster(tp)");
    expect(script).toContain("bc1:IsSetCard(SET_PERFORMAPAL)");
    expect(script).toContain("not bc2:IsAttack(bc2:GetBaseAttack())");
    expect(script).toContain("local diff=math.abs(bc:GetBaseAttack()-bc:GetAttack())");
    expect(script).toContain("e1:SetValue(-diff)");

    const barracudaData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === barracudaCode);
    expect(barracudaData).toBeDefined();
    const reader = createCardReader([
      barracudaData!,
      { code: attackerCode, name: "Barracuda Performapal Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000, setcodes: [setPerformapal] },
      { code: defenderCode, name: "Barracuda Modified Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeEarth, level: 4, attack: 2200, defense: 1000 },
    ] satisfies DuelCardData[]);
    const session = createDuel({ seed: 92767273, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [barracudaCode, attackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const barracuda = requireCard(session, barracudaCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpPzone(session, barracuda, 0, 0);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0).attackModifier = -400;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(barracudaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentAttack(defender, session.state)).toBe(1800);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle, "battleConfirmed");

    const restoredConfirm = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredConfirm);
    expectRestoredLegalActions(restoredConfirm, 0);
    expect(restoredConfirm.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventUids: trigger.eventUids,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1133", eventCardUid: attacker.uid, eventCode: 1133, eventName: "battleConfirmed", eventUids: [attacker.uid, defender.uid], player: 0, sourceUid: barracuda.uid, triggerBucket: "turnOptional" },
    ]);
    const confirmTrigger = getLuaRestoreLegalActions(restoredConfirm, 0).find((action) => action.type === "activateTrigger" && action.uid === barracuda.uid);
    expect(confirmTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredConfirm, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredConfirm, confirmTrigger!);
    resolveRestoredChain(restoredConfirm);

    expect(currentAttack(findCard(restoredConfirm.session, defender.uid), restoredConfirm.session.state)).toBe(1400);
    expect(restoredConfirm.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x400, reset: { flags: 33427456 }, value: -400 },
    ]);
    expect(restoredConfirm.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores monster-zone quick effect into Performapal ATK gain equal to current/base ATK difference", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${barracudaCode}.lua`);
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("return c:IsSetCard(SET_PERFORMAPAL) and c:IsFaceup() and not c:IsAttack(c:GetBaseAttack())");
    expect(script).toContain("Duel.SelectTarget(tp,s.ppalatkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetValue(diff)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const barracudaData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === barracudaCode);
    expect(barracudaData).toBeDefined();
    const reader = createCardReader([
      barracudaData!,
      { code: performapalTargetCode, name: "Barracuda Performapal Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000, setcodes: [setPerformapal] },
      { code: defenderCode, name: "Barracuda Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    ] satisfies DuelCardData[]);
    const session = createDuel({ seed: 92767274, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [barracudaCode, performapalTargetCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const barracuda = requireCard(session, barracudaCode);
    const target = requireCard(session, performapalTargetCode);
    const decoy = requireCard(session, defenderCode);
    moveFaceUpAttack(session, target, 0, 0).attackModifier = 500;
    moveFaceUpAttack(session, barracuda, 0, 1);
    moveFaceUpAttack(session, decoy, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(barracudaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentAttack(target, session.state)).toBe(1700);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const quickEffect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === barracuda.uid);
    expect(quickEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, quickEffect!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(findCard(restoredOpen.session, target.uid), restoredOpen.session.state)).toBe(2200);
    expect(currentAttack(findCard(restoredOpen.session, decoy.uid), restoredOpen.session.state)).toBe(1700);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x400, reset: { flags: 1107169792 }, value: 500 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: target.uid,
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpPzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, eventName: string): void {
  let guard = 0;
  while (!restored.session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
