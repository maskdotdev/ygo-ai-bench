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
const festiballoonCode = "6696168";
const attackTargetCode = "66961680";
const ownFieldCode = "66961681";
const opponentFieldCode = "66961682";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFestiballoonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${festiballoonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDark = 0x10;
const raceMachine = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasFestiballoonScript)("Lua real script Festiballoon attack field wipe", () => {
  it("restores attack-announce ATK gain and exact 5000 ATK field-wipe ignition", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${festiballoonCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)");
    expect(script).toContain("return c==handler or c==handler:GetBattleTarget()");
    expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e2:SetOperation(function(e) e:GetHandler():UpdateAttack(1000) end)");
    expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e3:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e3:SetCountLimit(1,id)");
    expect(script).toContain("local g=Duel.GetFieldGroup(tp,LOCATION_ONFIELD,LOCATION_ONFIELD)-c");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,tp,0)");
    expect(script).toContain("c:UpdateAttack(-5000)==-5000");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      {
        code: festiballoonCode,
        name: "Festiballoon",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceMachine,
        attribute: attributeDark,
        level: 8,
        attack: 5000,
        defense: 2500,
      },
      { code: attackTargetCode, name: "Festiballoon Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: ownFieldCode, name: "Festiballoon Own Field", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1200 },
      { code: opponentFieldCode, name: "Festiballoon Opponent Field", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6696168, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [festiballoonCode, ownFieldCode] }, 1: { main: [attackTargetCode, opponentFieldCode] } });
    startDuel(session);

    const festiballoon = requireCard(session, festiballoonCode);
    const attackTarget = requireCard(session, attackTargetCode);
    const ownField = requireCard(session, ownFieldCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveFaceUpAttack(session, festiballoon, 0);
    moveFaceUpAttack(session, ownField, 0);
    moveFaceUpAttack(session, attackTarget, 1);
    moveFaceUpAttack(session, opponentField, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(festiballoonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === festiballoon.uid && action.targetUid === attackTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([]);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === festiballoon.uid), restoredBattle.session.state)).toBe(6000);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: festiballoon.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0 },
    ]);

    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === festiballoon.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(ignition)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restoredIgnition, ignition!);
    passRestoredChain(restoredIgnition);

    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === festiballoon.uid), restoredIgnition.session.state)).toBe(0);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === festiballoon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect([ownField, attackTarget, opponentField].map((card) => restoredIgnition.session.state.cards.find((candidate) => candidate.uid === card.uid)).map((card) => ({
      location: card?.location,
      controller: card?.controller,
      reason: card?.reason,
      reasonPlayer: card?.reasonPlayer,
      reasonCardUid: card?.reasonCardUid,
      reasonEffectId: card?.reasonEffectId,
    }))).toEqual([
      { location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: festiballoon.uid, reasonEffectId: 3 },
      { location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: festiballoon.uid, reasonEffectId: 3 },
      { location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: festiballoon.uid, reasonEffectId: 3 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => event.eventName === "destroyed").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownField.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: festiballoon.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: attackTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: festiballoon.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentField.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: festiballoon.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownField.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: festiballoon.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
