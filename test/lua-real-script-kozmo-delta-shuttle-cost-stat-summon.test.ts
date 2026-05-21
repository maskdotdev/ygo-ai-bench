import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const deltaCode = "37679169";
const hasDeltaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${deltaCode}.lua`));
const statCostCode = "376791690";
const summonTargetCode = "376791691";
const faceupTargetCode = "376791692";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setKozmo = 0xd2;
const raceMachine = 0x20;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasDeltaScript)("Lua real script Kozmo Delta Shuttle cost stat and summon", () => {
  it("restores Deck send cost label ATK/DEF reduction and destroyed self-banish Deck summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${deltaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_DECK,0,1,nil)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(tc,REASON_COST)");
    expect(script).toContain("e:SetLabel(tc:GetLevel())");
    expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("return c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
    expect(script).toContain("Duel.Remove(c,POS_FACEUP,REASON_COST)");
    expect(script).toContain("return c:IsSetCard(SET_KOZMO) and c:IsLevelBelow(4) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: deltaCode, name: "Kozmo Delta Shuttle", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKozmo], race: raceMachine, level: 5, attack: 2000, defense: 2000 },
      { code: statCostCode, name: "Kozmo Delta Cost Ship", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKozmo], race: raceMachine, level: 5, attack: 1800, defense: 1800 },
      { code: summonTargetCode, name: "Kozmo Delta Deck Recruit", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKozmo], race: raceWarrior, level: 3, attack: 1200, defense: 1000 },
      { code: faceupTargetCode, name: "Kozmo Delta Face-Up Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1500 },
    ];
    const reader = createCardReader(cards);

    const statSession = createDuel({ seed: 37679169, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [deltaCode, statCostCode] }, 1: { main: [faceupTargetCode] } });
    startDuel(statSession);
    const statDelta = requireCard(statSession, deltaCode);
    const costCard = requireCard(statSession, statCostCode);
    const statTarget = requireCard(statSession, faceupTargetCode);
    moveFaceUpAttack(statSession, statDelta, 0);
    moveFaceUpAttack(statSession, statTarget, 1);
    statSession.state.phase = "main1";
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(deltaCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statDelta.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStat, statAction!);
    expect(restoredStat.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredStat.session.state.cards.find((card) => card.uid === costCard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statDelta.uid,
      reasonEffectId: 1,
    });
    expect(restoredStat.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costCard.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: statDelta.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: statDelta.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statDelta.uid), restoredStat.session.state)).toBe(1500);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === statDelta.uid), restoredStat.session.state)).toBe(1500);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statTarget.uid), restoredStat.session.state)).toBe(1800);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === statDelta.uid && [100, 104].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, sourceUid: statDelta.uid, value: -500 },
      { code: 104, reset: { flags: 33427456 }, sourceUid: statDelta.uid, value: -500 },
    ]);

    const summonSession = createDuel({ seed: 37679170, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [deltaCode, summonTargetCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonDelta = requireCard(summonSession, deltaCode);
    const recruit = requireCard(summonSession, summonTargetCode);
    moveFaceUpAttack(summonSession, summonDelta, 0);
    summonSession.state.phase = "main1";
    summonSession.state.waitingFor = 0;
    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(deltaCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(summonSession.state, summonDelta.uid, 0, duelReason.effect | duelReason.destroy, 0);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-2-1014",
        sourceUid: summonDelta.uid,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect | duelReason.destroy,
        player: 0,
        triggerBucket: "turnOptional",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonDelta.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === summonDelta.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: summonDelta.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === recruit.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonDelta.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "banished", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: summonDelta.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: summonDelta.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: summonDelta.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonDelta.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: recruit.uid,
        eventUids: [recruit.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonDelta.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
