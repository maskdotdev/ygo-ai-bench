import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const greethysCode = "8576764";
const hasGreethysScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${greethysCode}.lua`));
const reviveTargetCode = "85767640";
const synchroPartnerCode = "85767641";
const synchroCode = "85767642";
const opponentHandCode = "85767643";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceFish = 0x400;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts || !hasGreethysScript)("Lua real script Greethys hand-count revive and material stat", () => {
  it("restores hand-count GY revive target lock and Synchro material ATK/DEF gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${greethysCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("local sum=Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)");
    expect(script).toContain("and c:HasLevel() and c:IsLevelBelow(lv) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp,sum)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp,sum)");
    expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_TRIGGER)");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and r==REASON_SYNCHRO and Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>0");
    expect(script).toContain("local val=Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)*200");
    expect(script).toContain("local sync=c:GetReasonCard()");
    expect(script).toContain("sync:UpdateAttack(val,RESET_EVENT|RESETS_STANDARD,c)");
    expect(script).toContain("sync:UpdateDefense(val,RESET_EVENT|RESETS_STANDARD,c)");

    const cards: DuelCardData[] = [
      { code: greethysCode, name: "Gluttonous Reptolphin Greethys", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceFish, level: 3, attack: 1000, defense: 1000 },
      { code: reviveTargetCode, name: "Greethys Aqua Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, level: 3, attack: 1200, defense: 800 },
      { code: synchroPartnerCode, name: "Greethys Synchro Partner", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 3, attack: 900, defense: 900 },
      { code: synchroCode, name: "Greethys Synchro Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, level: 6, attack: 2200, defense: 1800 },
      { code: opponentHandCode, name: "Greethys Opponent Hand Count", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 1, attack: 100, defense: 100 },
    ];
    const reader = createCardReader(cards);

    const reviveSession = createDuel({ seed: 8576764, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(reviveSession, { 0: { main: [greethysCode, reviveTargetCode] }, 1: { main: [opponentHandCode, opponentHandCode, opponentHandCode] } });
    startDuel(reviveSession);
    const reviveGreethys = requireCard(reviveSession, greethysCode);
    const reviveTarget = requireCard(reviveSession, reviveTargetCode);
    moveFaceUpAttack(reviveSession, reviveGreethys, 0);
    moveDuelCard(reviveSession.state, reviveTarget.uid, "graveyard", 0);
    for (const card of reviveSession.state.cards.filter((candidate) => candidate.code === opponentHandCode)) moveDuelCard(reviveSession.state, card.uid, "hand", 1);
    reviveSession.state.phase = "main1";
    reviveSession.state.waitingFor = 0;
    const reviveHost = createLuaScriptHost(reviveSession, workspace);
    expect(reviveHost.loadCardScript(Number(greethysCode), workspace).ok).toBe(true);
    expect(reviveHost.registerInitialEffects()).toBe(1);

    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(reviveSession), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const reviveAction = getLuaRestoreLegalActions(restoredRevive, 0).find((action) => action.type === "activateEffect" && action.uid === reviveGreethys.uid);
    expect(reviveAction, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredRevive, reviveAction!);
    expect(restoredRevive.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredRevive.session.state.cards.find((card) => card.uid === reviveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: reviveGreethys.uid,
      reasonEffectId: 1,
    });
    expect(restoredRevive.session.state.effects.filter((effect) => effect.sourceUid === reviveTarget.uid && effect.code === 7)).toEqual([
      expect.objectContaining({
        event: "continuous",
        code: 7,
        range: ["monsterZone"],
      }),
    ]);
    expect(restoredRevive.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: reviveTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: reviveTarget.uid,
        eventUids: [reviveTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: reviveGreethys.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredAfterRevive = restoreDuelWithLuaScripts(serializeDuel(restoredRevive.session), workspace, reader);
    expectCleanRestore(restoredAfterRevive);
    expectRestoredLegalActions(restoredAfterRevive, 0);

    const materialSession = createDuel({ seed: 8576765, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(materialSession, { 0: { main: [greethysCode, synchroPartnerCode], extra: [synchroCode] }, 1: { main: [opponentHandCode, opponentHandCode, opponentHandCode] } });
    startDuel(materialSession);
    const materialGreethys = requireCard(materialSession, greethysCode);
    const partner = requireCard(materialSession, synchroPartnerCode);
    const synchro = requireCard(materialSession, synchroCode);
    moveFaceUpAttack(materialSession, materialGreethys, 0);
    moveFaceUpAttack(materialSession, partner, 0);
    for (const card of materialSession.state.cards.filter((candidate) => candidate.code === opponentHandCode)) moveDuelCard(materialSession.state, card.uid, "hand", 1);
    materialSession.state.phase = "main1";
    materialSession.state.waitingFor = 0;
    const materialHost = createLuaScriptHost(materialSession, workspace);
    expect(materialHost.loadCardScript(Number(greethysCode), workspace).ok).toBe(true);
    expect(materialHost.registerInitialEffects()).toBe(1);
    expect(materialSession.state.effects.find((effect) => effect.sourceUid === materialGreethys.uid && effect.code === eventBeMaterial)).toMatchObject({
      code: eventBeMaterial,
      event: "trigger",
      triggerEvent: "usedAsMaterial",
      triggerSourceOnly: true,
    });

    const restoredMaterialOpen = restoreDuelWithLuaScripts(serializeDuel(materialSession), workspace, reader);
    expectCleanRestore(restoredMaterialOpen);
    expectRestoredLegalActions(restoredMaterialOpen, 0);
    synchroSummonDuelCard(restoredMaterialOpen.session.state, 0, synchro.uid, [materialGreethys.uid, partner.uid]);
    expect(restoredMaterialOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-1108",
        eventCardUid: materialGreethys.uid,
        eventCode: eventBeMaterial,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.synchro,
        eventReasonCardUid: synchro.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: materialGreethys.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredMaterialTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredMaterialOpen.session), workspace, reader);
    expectCleanRestore(restoredMaterialTrigger);
    expectRestoredLegalActions(restoredMaterialTrigger, 0);
    const materialTrigger = getLuaRestoreLegalActions(restoredMaterialTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === materialGreethys.uid);
    expect(materialTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredMaterialTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredMaterialTrigger, materialTrigger!);
    expect(currentAttack(restoredMaterialTrigger.session.state.cards.find((card) => card.uid === synchro.uid), restoredMaterialTrigger.session.state)).toBe(2800);
    expect(currentDefense(restoredMaterialTrigger.session.state.cards.find((card) => card.uid === synchro.uid), restoredMaterialTrigger.session.state)).toBe(2400);
    const restoredMaterialResolved = restoreDuelWithLuaScripts(serializeDuel(restoredMaterialTrigger.session), workspace, reader);
    expectCleanRestore(restoredMaterialResolved);
    expectRestoredLegalActions(restoredMaterialResolved, 0);
    expect(currentAttack(restoredMaterialResolved.session.state.cards.find((card) => card.uid === synchro.uid), restoredMaterialResolved.session.state)).toBe(2800);
    expect(currentDefense(restoredMaterialResolved.session.state.cards.find((card) => card.uid === synchro.uid), restoredMaterialResolved.session.state)).toBe(2400);
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
