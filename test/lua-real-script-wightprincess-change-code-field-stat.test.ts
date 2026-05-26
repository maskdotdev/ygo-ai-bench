import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardCodes } from "#duel/card-code-state.js";
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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const wightprincessCode = "90243945";
const hasWightprincessScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wightprincessCode}.lua`));
const wightprinceCode = "57473560";
const allyCode = "902439450";
const opponentCode = "902439451";
const skullServantCode = "32274490";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasWightprincessScript)("Lua real script Wightprincess change-code field stat", () => {
  it("restores GY Skull Servant code, summon-success Deck send, and self-to-GY field ATK/DEF reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wightprincessCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e1:SetValue(CARD_SKULL_SERVANT)");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsCode(57473560) and c:IsAbleToGrave()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
    expect(script).toContain("e4:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("e4:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("local val=tc:HasLevel() and tc:GetLevel()*-300 or tc:GetRank()*-300");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: wightprincessCode, name: "Wightprincess", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1600, defense: 0 },
      { code: wightprinceCode, name: "Wightprince", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 0, defense: 0 },
      { code: allyCode, name: "Wightprincess Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1500 },
      { code: opponentCode, name: "Wightprincess Opponent", kind: "monster", typeFlags: typeMonster, level: 2, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const summonSession = createDuel({ seed: 90243945, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [wightprincessCode, wightprinceCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonedPrincess = requireCard(summonSession, wightprincessCode);
    const prince = requireCard(summonSession, wightprinceCode);
    moveDuelCard(summonSession.state, summonedPrincess.uid, "hand", 0);
    summonSession.state.phase = "main1";
    summonSession.state.waitingFor = 0;
    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(wightprincessCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === summonedPrincess.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1100",
        eventCardUid: summonedPrincess.uid,
        eventCode: 1100,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "normalSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: summonedPrincess.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonedPrincess.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === prince.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonedPrincess.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summonedPrincess.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: prince.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonedPrincess.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const statSession = createDuel({ seed: 90243946, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [wightprincessCode, allyCode] }, 1: { main: [opponentCode] } });
    startDuel(statSession);
    const statPrincess = requireCard(statSession, wightprincessCode);
    const ally = requireCard(statSession, allyCode);
    const opponent = requireCard(statSession, opponentCode);
    moveDuelCard(statSession.state, statPrincess.uid, "hand", 0);
    moveFaceUpAttack(statSession, ally, 0);
    moveFaceUpAttack(statSession, opponent, 1);
    statSession.state.phase = "main1";
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(wightprincessCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statPrincess.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStat, statAction!);
    expect(restoredStat.session.state.cards.find((card) => card.uid === statPrincess.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statPrincess.uid,
      reasonEffectId: 4,
    });
    expect(currentCardCodes(restoredStat.session.state.cards.find((card) => card.uid === statPrincess.uid)!, restoredStat.session.state)).toEqual([skullServantCode]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === ally.uid), restoredStat.session.state)).toBe(800);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === ally.uid), restoredStat.session.state)).toBe(300);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponent.uid), restoredStat.session.state)).toBe(600);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === opponent.uid), restoredStat.session.state)).toBe(400);
    expect(restoredStat.session.state.effects.filter((effect) => [100, 104, 114].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 114, range: ["graveyard"], reset: undefined, sourceUid: statPrincess.uid, value: Number(skullServantCode) },
      { code: 100, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: ally.uid, value: -1200 },
      { code: 104, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: ally.uid, value: -1200 },
      { code: 100, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: opponent.uid, value: -600 },
      { code: 104, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: opponent.uid, value: -600 },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentCardCodes(restoredResolved.session.state.cards.find((card) => card.uid === statPrincess.uid)!, restoredResolved.session.state)).toEqual([skullServantCode]);
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
