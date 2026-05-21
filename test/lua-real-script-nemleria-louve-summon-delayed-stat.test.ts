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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const louveCode = "57296396";
const nemleriaTargetCode = "572963960";
const opponentTargetCode = "572963961";
const banishedA = "572963962";
const banishedB = "572963963";
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const attributeLight = 0x10;
const setNemleria = 0x192;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nemleria Louve summon delayed stat", () => {
  it("restores deck summon with delayed return and grave self-banish face-down banished count stat reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${louveCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(sc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("aux.DelayedOperation(sc,PHASE_END,id,e,tp,function(ag) Duel.SendtoHand(ag,nil,REASON_EFFECT) end,nil,0,0,aux.Stringid(id,2))");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFacedown,tp,LOCATION_REMOVED,0,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsFacedown,tp,LOCATION_REMOVED,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === louveCode),
      { code: nemleriaTargetCode, name: "Nemleria Louve Deck Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeLight, level: 10, attack: 2500, defense: 2000, setcodes: [setNemleria] },
      { code: opponentTargetCode, name: "Nemleria Louve Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeLight, level: 4, attack: 2400, defense: 1800 },
      { code: banishedA, name: "Nemleria Face-Down Banished A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: banishedB, name: "Nemleria Face-Down Banished B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const summonSession = createDuel({ seed: 57296396, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [louveCode, nemleriaTargetCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonLouve = requireCard(summonSession, louveCode);
    const summonTarget = requireCard(summonSession, nemleriaTargetCode);
    const setLouve = moveDuelCard(summonSession.state, summonLouve.uid, "spellTrapZone", 0);
    setLouve.position = "faceDown";
    setLouve.faceUp = false;
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;
    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(louveCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);

    const restoredSummonOpen = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const summonAction = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "activateEffect" && action.uid === summonLouve.uid);
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonOpen, summonAction!);
    expect(restoredSummonOpen.session.state.chain).toEqual([]);
    expect(restoredSummonOpen.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonLouve.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonOpen.session.state.chain.at(-1)?.operationInfos).toBeUndefined();
    expect(restoredSummonOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summonTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonTarget.uid,
        eventUids: [summonTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonLouve.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    expect(restoredSummonOpen.session.state.effects.find((effect) => effect.sourceUid === summonLouve.uid && effect.code === phaseEndEventCode)).toMatchObject({
      event: "continuous",
      triggerEvent: "phaseEnd",
      sourceUid: summonLouve.uid,
    });

    const restoredEndPhase = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), workspace, reader);
    expectCleanRestore(restoredEndPhase);
    expectRestoredLegalActions(restoredEndPhase, 0);
    advanceRestoredToPhase(restoredEndPhase, 0, ["battle", "main2", "end"]);
    expect(restoredEndPhase.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonLouve.uid,
      reasonEffectId: 3,
    });
    expect(restoredEndPhase.session.state.eventHistory.filter((event) => ["sentToHand", "phaseEnd"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: summonTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonLouve.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceUpDefense", sequence: 0 },
      },
      { eventName: "phaseEnd", eventCode: phaseEndEventCode },
    ]);

    const statSession = createDuel({ seed: 57296397, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [louveCode, banishedA, banishedB] }, 1: { main: [opponentTargetCode] } });
    startDuel(statSession);
    const statLouve = requireCard(statSession, louveCode);
    const statTarget = requireCard(statSession, opponentTargetCode);
    const fdA = requireCard(statSession, banishedA);
    const fdB = requireCard(statSession, banishedB);
    moveDuelCard(statSession.state, statLouve.uid, "graveyard", 0);
    const firstBanished = moveDuelCard(statSession.state, fdA.uid, "banished", 0);
    firstBanished.faceUp = false;
    firstBanished.position = "faceDown";
    const secondBanished = moveDuelCard(statSession.state, fdB.uid, "banished", 0);
    secondBanished.faceUp = false;
    secondBanished.position = "faceDown";
    moveDuelCard(statSession.state, statTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    statTarget.faceUp = true;
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(louveCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStatOpen = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStatOpen);
    expectRestoredLegalActions(restoredStatOpen, 0);
    const statAction = getLuaRestoreLegalActions(restoredStatOpen, 0).find((action) => action.type === "activateEffect" && action.uid === statLouve.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStatOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStatOpen, statAction!);
    expect(restoredStatOpen.session.state.chain).toEqual([]);
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === statLouve.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statLouve.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredStatOpen.session.state.cards.find((card) => card.uid === statTarget.uid), restoredStatOpen.session.state)).toBe(2200);
    expect(currentDefense(restoredStatOpen.session.state.cards.find((card) => card.uid === statTarget.uid), restoredStatOpen.session.state)).toBe(1600);
    expect(restoredStatOpen.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: statLouve.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: statLouve.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 2 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: statTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
  });
});

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

function advanceRestoredToPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phases: Array<"battle" | "main2" | "end">): void {
  for (const phase of phases) {
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, action!);
  }
}
