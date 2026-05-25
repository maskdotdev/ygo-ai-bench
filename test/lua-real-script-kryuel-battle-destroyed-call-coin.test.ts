import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const kryuelCode = "82642348";
const attackerCode = "826423480";
const targetCode = "826423481";
const hasKryuelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kryuelCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasKryuelScript)("Lua real script Kryuel battle destroyed CallCoin", () => {
  it("restores its forced battle-destroyed trigger into a called-coin opponent monster destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kryuelCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kryuelCode, targetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const kryuel = requireCard(session, kryuelCode);
    const target = requireCard(session, targetCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, kryuel, 0, 0);
    moveFaceUpAttack(session, target, 1, 1);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kryuelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === kryuel.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCoin | categoryDestroy, code: 1140, event: "trigger", triggerEvent: "battleDestroyed" },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === kryuel.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passBattleResponses(restoredOpen.session);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === kryuel.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: attacker.uid,
    });
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-1-1140",
        sourceUid: kryuel.uid,
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: kryuel.uid,
        eventPlayer: 0,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === kryuel.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: kryuel.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "coinTossed", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: kryuel.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: kryuel.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kryuel.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: attacker.uid,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kryuel.uid,
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
  expect(script).toContain("--Kryuel");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_COIN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("if Duel.CallCoin(tp) then");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: kryuelCode, name: "Kryuel", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1700 },
    { code: attackerCode, name: "Kryuel Battle Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
    { code: targetCode, name: "Kryuel Destroy Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
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

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
