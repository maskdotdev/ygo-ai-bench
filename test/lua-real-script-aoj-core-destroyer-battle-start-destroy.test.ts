import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ally of Justice Core Destroyer battle-start destroy", () => {
  it("restores defender-side EVENT_BATTLE_START and destroys the attacking LIGHT monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coreDestroyerCode = "36629203";
    const lightAttackerCode = "366292030";
    const script = workspace.readScript(`c${coreDestroyerCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("local tc=Duel.GetAttacker()");
    expect(script).toContain("if tc==c then tc=Duel.GetAttackTarget() end");
    expect(script).toContain("tc:IsFaceup() and tc:IsAttribute(ATTRIBUTE_LIGHT)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,tc,1,0,0)");
    expect(script).toContain("tc:IsRelateToBattle()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coreDestroyerCode),
      { code: lightAttackerCode, name: "Core Destroyer LIGHT Attacker", kind: "monster", typeFlags: typeMonster, attribute: attributeLight, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 36629203, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lightAttackerCode] }, 1: { main: [coreDestroyerCode] } });
    startDuel(session);

    const attacker = requireCard(session, lightAttackerCode);
    const coreDestroyer = requireCard(session, coreDestroyerCode);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0);
    attacker.position = "faceUpAttack";
    attacker.faceUp = true;
    moveDuelCard(session.state, coreDestroyer.uid, "monsterZone", 1);
    coreDestroyer.position = "faceUpAttack";
    coreDestroyer.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(coreDestroyerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => (
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === coreDestroyer.uid
    ));
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session, "battleStarted");

    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: coreDestroyer.uid });
    expect(session.state.pendingTriggers).toMatchObject([
      {
        sourceUid: coreDestroyer.uid,
        player: 1,
        triggerBucket: "opponentMandatory",
        eventName: "battleStarted",
        eventCode: 1132,
        eventCardUid: coreDestroyer.uid,
        eventUids: [attacker.uid, coreDestroyer.uid],
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.battleWindow?.kind).toBe("startDamageStep");
    expectRestoredLegalActions(restored, 1);
    const trigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === coreDestroyer.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyRestoredAndAssert(restored, trigger!);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleWindow).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === coreDestroyer.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpAttack",
    });
    expect(restored.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: coreDestroyer.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["battleStarted", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "battleStarted",
        eventCode: 1132,
        eventCardUid: attacker.uid,
        eventUids: [attacker.uid, coreDestroyer.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: attacker.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: coreDestroyer.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (!session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
