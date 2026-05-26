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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const arakamiCode = "59789370";
const matchingMachineCode = "597893700";
const lowerMachineCode = "597893701";
const higherMachineDecoyCode = "597893702";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gizmek Arakami self summon banish stat", () => {
  it("restores hand condition self summon and grave self-banish target Deck send ATK/DEF gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${arakamiCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_MACHINE) and c:IsDefense(c:GetAttack())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.IsExistingTarget(s.tgfilter,tp,LOCATION_MZONE,0,1,nil,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,tp,LOCATION_MZONE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DEFCHANGE,g,1,tp,LOCATION_MZONE)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter2,tp,LOCATION_DECK,0,1,1,nil,tc:GetLevel()):GetFirst()");
    expect(script).toContain("Duel.SendtoGrave(tg,REASON_EFFECT)>0 and Duel.GetOperatedGroup():GetFirst():IsLocation(LOCATION_GRAVE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(tg:GetLevel()*100)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards = arakamiCards();
    const reader = createCardReader(cards);

    const summonSession = createDuel({ seed: 59789370, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [arakamiCode, matchingMachineCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonArakami = requireCard(summonSession, arakamiCode);
    const matchingMachine = requireCard(summonSession, matchingMachineCode);
    moveDuelCard(summonSession.state, summonArakami.uid, "hand", 0);
    moveDuelCard(summonSession.state, matchingMachine.uid, "monsterZone", 0).position = "faceUpAttack";
    matchingMachine.faceUp = true;
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;

    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(arakamiCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);

    const restoredSummonOpen = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const summonAction = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "activateEffect" && action.uid === summonArakami.uid);
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonOpen, summonAction!);
    expect(restoredSummonOpen.session.state.chain).toEqual([]);
    expect(restoredSummonOpen.session.state.cards.find((card) => card.uid === summonArakami.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonArakami.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summonArakami.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonArakami.uid,
        eventUids: [summonArakami.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonArakami.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const graveSession = createDuel({ seed: 59789371, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(graveSession, { 0: { main: [arakamiCode, matchingMachineCode, lowerMachineCode, higherMachineDecoyCode] }, 1: { main: [] } });
    startDuel(graveSession);
    const graveArakami = requireCard(graveSession, arakamiCode);
    const target = requireCard(graveSession, matchingMachineCode);
    const lowerMachine = requireCard(graveSession, lowerMachineCode);
    const higherMachine = requireCard(graveSession, higherMachineDecoyCode);
    moveDuelCard(graveSession.state, graveArakami.uid, "graveyard", 0).position = "faceUpAttack";
    graveArakami.faceUp = true;
    moveDuelCard(graveSession.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    target.faceUp = true;
    graveSession.state.phase = "main1";
    graveSession.state.turnPlayer = 0;
    graveSession.state.waitingFor = 0;

    const graveHost = createLuaScriptHost(graveSession, workspace);
    expect(graveHost.loadCardScript(Number(arakamiCode), workspace).ok).toBe(true);
    expect(graveHost.registerInitialEffects()).toBe(1);

    const restoredGraveOpen = restoreDuelWithLuaScripts(serializeDuel(graveSession), workspace, reader);
    expectCleanRestore(restoredGraveOpen);
    expectRestoredLegalActions(restoredGraveOpen, 0);
    const graveAction = getLuaRestoreLegalActions(restoredGraveOpen, 0).find((action) => action.type === "activateEffect" && action.uid === graveArakami.uid);
    expect(graveAction, JSON.stringify(getLuaRestoreLegalActions(restoredGraveOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredGraveOpen, graveAction!);

    expect(restoredGraveOpen.session.state.chain).toEqual([]);
    expect(restoredGraveOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredGraveOpen.session.state.cards.find((card) => card.uid === graveArakami.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveArakami.uid,
      reasonEffectId: 2,
    });
    expect(restoredGraveOpen.session.state.cards.find((card) => card.uid === lowerMachine.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveArakami.uid,
      reasonEffectId: 2,
    });
    expect(restoredGraveOpen.session.state.cards.find((card) => card.uid === higherMachine.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(restoredGraveOpen.session.state.cards.find((card) => card.uid === target.uid), restoredGraveOpen.session.state)).toBe(2300);
    expect(currentDefense(restoredGraveOpen.session.state.cards.find((card) => card.uid === target.uid), restoredGraveOpen.session.state)).toBe(2300);
    expect(restoredGraveOpen.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveArakami.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveArakami.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: lowerMachine.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveArakami.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function arakamiCards(): DuelCardData[] {
  return [
    { code: arakamiCode, name: "Gizmek Arakami", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 6, attack: 1500, defense: 1500 },
    { code: matchingMachineCode, name: "Arakami Matching Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 5, attack: 2000, defense: 2000 },
    { code: lowerMachineCode, name: "Arakami Lower Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 3, attack: 900, defense: 900 },
    { code: higherMachineDecoyCode, name: "Arakami Higher Machine Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 7, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
