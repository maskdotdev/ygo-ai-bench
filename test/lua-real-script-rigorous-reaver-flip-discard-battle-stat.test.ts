import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const reaverCode = "39180960";
const hasReaverScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reaverCode}.lua`));
const ownDiscardCode = "391809600";
const opponentDiscardCode = "391809601";
const attackerCode = "391809602";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasReaverScript)("Lua real script Rigorous Reaver flip discard battle stat", () => {
  it("restores both-player Flip discard and battle-destroyed ATK/DEF loss on the battling monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${reaverCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_HANDES)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,PLAYER_ALL,1)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.TRUE,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SelectMatchingCard(1-tp,aux.TRUE,1-tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g1,REASON_DISCARD|REASON_EFFECT)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("local tc=Duel.GetAttacker()");
    expect(script).toContain("if c==tc then tc=Duel.GetAttackTarget() end");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetValue(-500)");

    const cards: DuelCardData[] = [
      { code: reaverCode, name: "Rigorous Reaver", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1600, defense: 100 },
      { code: ownDiscardCode, name: "Rigorous Reaver Own Discard", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentDiscardCode, name: "Rigorous Reaver Opponent Discard", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Rigorous Reaver Battle Destroyer", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2100, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 39180960, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reaverCode, ownDiscardCode] }, 1: { main: [opponentDiscardCode, attackerCode] } });
    startDuel(session);

    const reaver = requireCard(session, reaverCode);
    const ownDiscard = requireCard(session, ownDiscardCode);
    const opponentDiscard = requireCard(session, opponentDiscardCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, reaver.uid, "monsterZone", 0).position = "faceDownDefense";
    reaver.faceUp = false;
    moveDuelCard(session.state, ownDiscard.uid, "hand", 0);
    moveDuelCard(session.state, opponentDiscard.uid, "hand", 1);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
    attacker.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(reaverCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === reaver.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, flip!);

    const restoredFlipTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredFlipTrigger);
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    const flipTrigger = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === reaver.uid);
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredFlipTrigger, flipTrigger!);
    expect(restoredFlipTrigger.session.state.chain).toEqual([]);
    expect(restoredFlipTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredFlipTrigger.session.state.cards.find((card) => card.uid === ownDiscard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: reaver.uid,
      reasonEffectId: 1,
    });
    expect(restoredFlipTrigger.session.state.cards.find((card) => card.uid === opponentDiscard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: reaver.uid,
      reasonEffectId: 1,
    });

    restoredFlipTrigger.session.state.phase = "battle";
    restoredFlipTrigger.session.state.turnPlayer = 1;
    restoredFlipTrigger.session.state.waitingFor = 1;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredFlipTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === reaver.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.players[0]!.lifePoints).toBe(7500);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === reaver.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: attacker.uid,
    });

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === reaver.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleTrigger, battleTrigger!);
    const restoredAttacker = restoredBattleTrigger.session.state.cards.find((card) => card.uid === attacker.uid);
    expect(currentAttack(restoredAttacker, restoredBattleTrigger.session.state)).toBe(1600);
    expect(currentDefense(restoredAttacker, restoredBattleTrigger.session.state)).toBe(1300);
    expect(restoredBattleTrigger.session.state.eventHistory.filter((event) => ["discarded", "battleDestroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: ownDiscard.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: reaver.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: opponentDiscard.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: reaver.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: reaver.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
