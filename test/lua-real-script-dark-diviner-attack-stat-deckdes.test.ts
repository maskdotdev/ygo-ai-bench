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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const darkDivinerCode = "31919988";
const hasDarkDivinerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkDivinerCode}.lua`));
const defenderCode = "319199880";
const millACode = "319199881";
const millBCode = "319199882";
const millCCode = "319199883";
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDarkDivinerScript)("Lua real script Dark Diviner attack stat deckdes", () => {
  it("restores attack-announced target ATK matching into battle-destroying opponent Deck mill", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkDivinerCode}.lua`);
    expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_DARK),1,1,Synchro.NonTunerEx(Card.IsRace,RACE_INSECT),1,1)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("tc:GetAttack()>e:GetHandler():GetAttack()");
    expect(script).toContain("e:GetHandler():GetBattleTarget():CreateEffectRelation(e)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(c:GetAttack())");
    expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("tc:IsLocation(LOCATION_GRAVE) and tc:IsReason(REASON_BATTLE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,1-tp,3)");
    expect(script).toContain("Duel.DiscardDeck(1-tp,3,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkDivinerCode),
      { code: defenderCode, name: "Dark Diviner Larger Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 1000 },
      { code: millACode, name: "Dark Diviner Mill A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: millBCode, name: "Dark Diviner Mill B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: millCCode, name: "Dark Diviner Mill C", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 31919988, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkDivinerCode] }, 1: { main: [defenderCode, millACode, millBCode, millCCode] } });
    startDuel(session);

    const diviner = requireCard(session, darkDivinerCode);
    const defender = requireCard(session, defenderCode);
    const millA = requireCard(session, millACode);
    const millB = requireCard(session, millBCode);
    const millC = requireCard(session, millCCode);
    moveDuelCard(session.state, diviner.uid, "monsterZone", 0).position = "faceUpAttack";
    diviner.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    moveDuelCard(session.state, millA.uid, "deck", 1);
    moveDuelCard(session.state, millB.uid, "deck", 1);
    moveDuelCard(session.state, millC.uid, "deck", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkDivinerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === diviner.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);

    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1130",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: diviner.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: diviner.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackTrigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === diviner.uid);
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAttack, attackTrigger!);

    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === defender.uid), restoredAttack.session.state)).toBe(2000);
    expect(restoredAttack.session.state.currentAttack).toEqual({
      attackerUid: diviner.uid,
      targetUid: defender.uid,
      replayTargetCount: 1,
      replayTargetUids: [defender.uid],
    });
    expect(restoredAttack.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passBattleUntilTrigger(restoredAttack);

    expect(restoredAttack.session.state.cards.find((card) => card.uid === diviner.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredAttack.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: diviner.uid,
    });
    expect(restoredAttack.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-4-1139",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: diviner.uid,
        eventPlayer: 1,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: diviner.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: diviner.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredDestroying = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredDestroying);
    expectRestoredLegalActions(restoredDestroying, 0);
    const destroyingTrigger = getLuaRestoreLegalActions(restoredDestroying, 0).find((action) => action.type === "activateTrigger" && action.uid === diviner.uid);
    expect(destroyingTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroying, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDestroying, destroyingTrigger!);

    expect(restoredDestroying.session.state.chain).toEqual([]);
    expect(restoredDestroying.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect([millA, millB, millC].map((card) => restoredDestroying.session.state.cards.find((candidate) => candidate.uid === card.uid)).map((card) => ({
      location: card?.location,
      controller: card?.controller,
      reason: card?.reason,
      reasonPlayer: card?.reasonPlayer,
      reasonCardUid: card?.reasonCardUid,
      reasonEffectId: card?.reasonEffectId,
    }))).toEqual([
      { location: "graveyard", controller: 1, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: diviner.uid, reasonEffectId: 4 },
      { location: "graveyard", controller: 1, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: diviner.uid, reasonEffectId: 4 },
      { location: "graveyard", controller: 1, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: diviner.uid, reasonEffectId: 4 },
    ]);
    expect(restoredDestroying.session.state.eventHistory.filter((event) => ["battleDestroyed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: defender.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: diviner.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: defender.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: diviner.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      ...[millA, millB, millC].map((card, index) => ({
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: card.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: diviner.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: index },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: index + 1 },
      })),
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: millA.uid,
        eventUids: [millA.uid, millB.uid, millC.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: diviner.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
