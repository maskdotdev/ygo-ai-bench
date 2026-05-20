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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const halberdCode = "53950487";
const hasHalberdScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${halberdCode}.lua`));
const defenderCode = "539504870";
const allyCode = "539504871";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceInsect = 0x800;
const setBattlewasp = 0x12f;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHalberdScript)("Lua real script Halberd pre-damage stat burn", () => {
  it("restores pre-damage opposing ATK halving into battle-damage Battlewasp count burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${halberdCode}.lua`);
    expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_INSECT),1,1,Synchro.NonTuner(nil),1,99)");
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("return c==Duel.GetAttacker() and d and d:IsFaceup() and not d:IsControler(tp) and d:GetAttack()>=c:GetAttack()");
    expect(script).toContain("c:RegisterFlagEffect(id,RESET_CHAIN,0,1)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE_CAL)");
    expect(script).toContain("e1:SetValue(d:GetAttack()/2)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.damfilter,tp,LOCATION_MZONE,0,nil)*200");
    expect(script).toContain("Duel.Damage(p,val,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === halberdCode),
      { code: defenderCode, name: "Halberd Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 1000 },
      { code: allyCode, name: "Halberd Battlewasp Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBattlewasp], level: 4, race: raceInsect, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 53950487, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [halberdCode, allyCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const halberd = requireCard(session, halberdCode);
    const ally = requireCard(session, allyCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, halberd.uid, "monsterZone", 0).position = "faceUpAttack";
    halberd.faceUp = true;
    moveDuelCard(session.state, ally.uid, "monsterZone", 0).position = "faceUpAttack";
    ally.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(halberdCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attack = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "declareAttack" && action.attackerUid === halberd.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAttack, attack!);
    passBattleUntilWindow(restoredAttack, "beforeDamageCalculation");
    passBattle(restoredAttack);

    expect(restoredAttack.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    const statAction = getLuaRestoreLegalActions(restoredAttack, restoredAttack.session.state.waitingFor ?? 0).find((action) => action.type === "activateEffect" && action.uid === halberd.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, restoredAttack.session.state.waitingFor ?? 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAttack, statAction!);

    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === defender.uid), restoredAttack.session.state)).toBe(1500);
    expect(restoredAttack.session.state.currentAttack).toEqual({
      attackerUid: halberd.uid,
      targetUid: defender.uid,
      replayTargetCount: 1,
      replayTargetUids: [defender.uid],
    });
    expect(restoredAttack.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    passBattleUntilTrigger(restoredAttack);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: halberd.uid,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: halberd.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredAttack.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-3-1143",
        eventCardUid: halberd.uid,
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: halberd.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: halberd.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === halberd.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(6600);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 400,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: halberd.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passBattleUntilWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: string): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    passBattle(restored);
  }
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    passBattle(restored);
  }
}

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
