import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isAttackPrevented } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const dangersCode = "22082432";
const raCode = "10000010";
const releaseCode = "220824320";
const ownOtherCode = "220824321";
const opponentOtherCode = "220824322";
const typeMonster = 0x1;
const typeEffect = 0x20;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dangers of the Divine release Ra delayed", () => {
  it("restores LP plus release cost into ignored-condition Ra SpecialSummonStep, stat lock, attack lock, and delayed return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dangersCode}.lua`);
    expect(script).toContain("e1:SetCost(Cost.AND(Cost.PayLP(1/2),s.cost))");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.spcostfilter,1,false,nil,nil,tp)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.spcostfilter,1,1,false,nil,nil,tp)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_REMOVED)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_MZONE)");
    expect(script).toContain("Duel.SpecialSummonStep(sc,0,tp,tp,true,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("aux.DelayedOperation(sc,PHASE_END,id,e,tp,");
    expect(script).toContain("Duel.SendtoHand(ag,nil,REASON_EFFECT)");
    expect(script).toContain("function() return Duel.GetTurnCount()==turn_count+1 end");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dangersCode || card.code === raCode),
      { code: releaseCode, name: "Dangers of the Divine Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: ownOtherCode, name: "Dangers of the Divine Own Other Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: opponentOtherCode, name: "Dangers of the Divine Opponent Other Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1300, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22082432, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dangersCode, releaseCode, ownOtherCode], extra: [] }, 1: { main: [raCode, opponentOtherCode] } });
    startDuel(session);

    const dangers = requireCard(session, dangersCode);
    const ra = requireCard(session, raCode);
    const release = requireCard(session, releaseCode);
    const ownOther = requireCard(session, ownOtherCode);
    const opponentOther = requireCard(session, opponentOtherCode);
    moveDuelCard(session.state, dangers.uid, "spellTrapZone", 0).position = "faceDown";
    dangers.faceUp = false;
    moveFaceUpAttack(session, release.uid, 0);
    moveFaceUpAttack(session, ownOther.uid, 0);
    moveDuelCard(session.state, ra.uid, "banished", 0);
    ra.faceUp = true;
    moveFaceUpAttack(session, opponentOther.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dangersCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dangers.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);

    expect(restoredOpen.session.state.players[0]!.lifePoints).toBe(4000);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: dangers.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);

    const restoredRa = restoredChain.session.state.cards.find((card) => card.uid === ra.uid);
    expect(restoredRa).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: dangers.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredRa, restoredChain.session.state)).toBe(4000);
    expect(currentDefense(restoredRa, restoredChain.session.state)).toBe(4000);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === ra.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 101, event: "continuous", reset: { flags: 33427456 }, value: 4000 },
      { code: 105, event: "continuous", reset: { flags: 33427456 }, value: 4000 },
      { code: 85, event: "continuous", reset: { flags: 33427456 }, value: 4000 },
    ]);
    expect(isAttackPrevented(restoredChain.session.state, restoredRa!, (effect, sourceCard, target) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, target, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.find((effect) => effect.event === "continuous" && effect.triggerEvent === "phaseEnd" && effect.sourceUid === dangers.uid)).toMatchObject({
      triggerCode: phaseEndEventCode,
      labelObjectUids: [ra.uid],
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["lifePointCostPaid", "released", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 4000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: dangers.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: release.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: dangers.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: ra.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: dangers.uid,
        eventReasonEffectId: 1,
        eventUids: [ra.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === dangers.uid)).toMatchObject({ location: "graveyard", controller: 0 });

    const restoredWatcher = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredWatcher);
    expectRestoredLegalActions(restoredWatcher, restoredWatcher.session.state.waitingFor ?? restoredWatcher.session.state.turnPlayer);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
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
    applyRestoredAction(restored, pass!);
  }
}
