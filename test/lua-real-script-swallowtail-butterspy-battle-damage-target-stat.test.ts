import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const butterspyCode = "79972330";
const attackerCode = "799723300";
const battleVictimCode = "799723301";
const statTargetCode = "799723302";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasButterspyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${butterspyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasButterspyScript)("Lua real script Swallowtail Butterspy battle damage target stat", () => {
  it("restores battle damage trigger into targeted opposing ATK reduction by damage value", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${butterspyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createBattleSession({ reader, workspace });
    const butterspy = requireCard(session, butterspyCode);
    const attacker = requireCard(session, attackerCode);
    const battleVictim = requireCard(session, battleVictimCode);
    const statTarget = requireCard(session, statTargetCode);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === battleVictim.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleUntilTrigger(session);
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });
    expect(session.state.cards.find((card) => card.uid === battleVictim.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: attacker.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1143",
        eventCardUid: attacker.uid,
        eventCode: 1143,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventValue: 1000,
        id: "trigger-5-1",
        player: 0,
        sourceUid: butterspy.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === butterspy.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, statTarget.uid), restoredTrigger.session.state)).toBe(800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: statTarget.uid, value: -1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: statTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
      },
    ]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(findCard(restoredStat.session, statTarget.uid), restoredStat.session.state)).toBe(800);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: butterspyCode, name: "Swallowtail Butterspy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1800, defense: 1200 },
    { code: attackerCode, name: "Butterspy Battle Damage Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 2000, defense: 1000 },
    { code: battleVictimCode, name: "Butterspy Battle Victim", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: statTargetCode, name: "Butterspy Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1800, defense: 1000 },
  ];
}

function createBattleSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 79972330, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [butterspyCode, attackerCode] }, 1: { main: [battleVictimCode, statTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, butterspyCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, battleVictimCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, statTargetCode), 1, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(butterspyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Swallowtail Butterspy");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_TRIGGER_F+EFFECT_TYPE_FIELD)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("return ep~=tp and rc~=e:GetHandler() and rc:IsControler(tp)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-ev)");
}

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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function passBattleUntilTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
