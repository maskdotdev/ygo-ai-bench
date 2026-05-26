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
const hamaCode = "80949182";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHamaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hamaCode}.lua`));
const destroyedTargetCode = "809491821";
const statTargetCode = "809491822";
const graveBattlewaspCode = "809491823";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setBattlewasp = 0x12f;

describe.skipIf(!hasUpstreamScripts || !hasHamaScript)("Lua real script Battlewasp Hama global battle damage stat", () => {
  it("restores GlobalCheck battle-damage gating into non-destroyed stat loss and Battle Phase burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hamaCode}.lua`);
    expect(script).toContain("e3:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.NOT(aux.FaceupFilter(Card.IsStatus,STATUS_BATTLE_DESTROYED)),tp,0,LOCATION_MZONE,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e4:SetCode(EVENT_PHASE|PHASE_BATTLE)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(dam)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.filter,tp,LOCATION_GRAVE,0,nil)*300");
    expect(script).toContain("aux.GlobalCheck(s,function()");
    expect(script).toContain("ge1:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("ge2:SetCode(EVENT_ADJUST)");

    const cards: DuelCardData[] = [
      { code: hamaCode, name: "Battlewasp - Hama the Conquering Bow", kind: "extra", typeFlags: typeMonster | typeEffect | 0x2000, setcodes: [setBattlewasp], level: 8, attack: 2800, defense: 2000 },
      { code: destroyedTargetCode, name: "Hama Destroyed Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: statTargetCode, name: "Hama Stat Loss Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1800 },
      { code: graveBattlewaspCode, name: "Hama Grave Battlewasp", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBattlewasp], level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 80949182, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [graveBattlewaspCode], extra: [hamaCode] }, 1: { main: [destroyedTargetCode, statTargetCode] } });
    startDuel(session);

    const hama = requireCard(session, hamaCode);
    const destroyedTarget = requireCard(session, destroyedTargetCode);
    const statTarget = requireCard(session, statTargetCode);
    const graveBattlewasp = requireCard(session, graveBattlewaspCode);
    moveFaceUpAttack(session, hama, 0);
    moveFaceUpAttack(session, destroyedTarget, 1);
    moveFaceUpAttack(session, statTarget, 1);
    moveDuelCard(session.state, graveBattlewasp.uid, "graveyard", 0).faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hamaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === hama.uid && action.targetUid === destroyedTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);
    expect(restoredSetup.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-5-1143",
        eventCardUid: hama.uid,
        eventCode: 1143,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle,
        eventReasonCardUid: hama.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventValue: 1800,
        player: 0,
        sourceUid: hama.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hama.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleTrigger, battleTrigger!);
    resolveRestoredChain(restoredBattleTrigger);

    expect(restoredBattleTrigger.session.state.cards.find((card) => card.uid === destroyedTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattleTrigger.session.state.cards.find((card) => card.uid === statTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === statTarget.uid), restoredBattleTrigger.session.state)).toBe(1000);
    expect(currentDefense(restoredBattleTrigger.session.state.cards.find((card) => card.uid === statTarget.uid), restoredBattleTrigger.session.state)).toBe(800);

    const restoredEndBattle = restoreDuelWithLuaScripts(serializeDuel(restoredBattleTrigger.session), workspace, reader);
    expectCleanRestore(restoredEndBattle);
    expectRestoredLegalActions(restoredEndBattle, 0);
    const main2 = getLuaRestoreLegalActions(restoredEndBattle, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredEndBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEndBattle, main2!);
    expect(restoredEndBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-9-1",
        effectId: "lua-6-4224",
        eventCode: 4224,
        eventName: "phaseBattle",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: hama.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredPhaseTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEndBattle.session), workspace, reader);
    expectCleanRestore(restoredPhaseTrigger);
    expectRestoredLegalActions(restoredPhaseTrigger, 0);
    const phaseTrigger = getLuaRestoreLegalActions(restoredPhaseTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hama.uid);
    expect(phaseTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPhaseTrigger, 0), null, 2)).toBeDefined();
    expect(phaseTrigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredPhaseTrigger, phaseTrigger!);
    expect(restoredPhaseTrigger.session.state.players[1].lifePoints).toBe(5900);
    expect(restoredPhaseTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: hama.uid,
        eventPlayer: 1,
        eventValue: 1800,
        eventReason: duelReason.battle,
        eventReasonCardUid: hama.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredPhaseTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hama.uid,
        eventReasonEffectId: 6,
      },
    ]);
  });
});

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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
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
