import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, fusionSummonDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const adLibitumCode = "81555617";
const levelFourCode = "815556170";
const opponentLevelEightCode = "815556171";
const despiaReviveTargetCode = "815556172";
const fusionPartnerCode = "815556173";
const fusionCode = "815556174";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAdLibitumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${adLibitumCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFairy = 0x4;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setDespia = 0x166;
const effectUpdateAttack = 100;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts || !hasAdLibitumScript)("Lua real script Ad Libitum of Despia field stat and material summon", () => {
  it("restores field-wide Level ATK gain and Fusion-material Despia revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${adLibitumCode}.lua`));
    const reader = createCardReader(cards());

    const restoredStat = createRestoredSession({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const adLibitum = requireCard(restoredStat.session, adLibitumCode);
    const levelFour = requireCard(restoredStat.session, levelFourCode);
    const opponentLevelEight = requireCard(restoredStat.session, opponentLevelEightCode);
    const fusionPartner = requireCard(restoredStat.session, fusionPartnerCode);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === adLibitum.uid && action.effectId === "lua-1");
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statAction!);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === adLibitum.uid), restoredStat.session.state)).toBe(2300);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === levelFour.uid), restoredStat.session.state)).toBe(1600);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === fusionPartner.uid), restoredStat.session.state)).toBe(1400);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponentLevelEight.uid), restoredStat.session.state)).toBe(2900);
    expect(restoredStat.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1644040704 }, sourceUid: adLibitum.uid, value: 800 },
      { code: effectUpdateAttack, reset: { flags: 1644040704 }, sourceUid: levelFour.uid, value: 400 },
      { code: effectUpdateAttack, reset: { flags: 1644040704 }, sourceUid: fusionPartner.uid, value: 400 },
      { code: effectUpdateAttack, reset: { flags: 1644040704 }, sourceUid: opponentLevelEight.uid, value: 800 },
    ]);

    const restoredMaterialOpen = createRestoredSession({ reader, workspace });
    expectCleanRestore(restoredMaterialOpen);
    expectRestoredLegalActions(restoredMaterialOpen, 0);
    const materialAdLibitum = requireCard(restoredMaterialOpen.session, adLibitumCode);
    const partner = requireCard(restoredMaterialOpen.session, fusionPartnerCode);
    const fusion = requireCard(restoredMaterialOpen.session, fusionCode);
    const reviveTarget = requireCard(restoredMaterialOpen.session, despiaReviveTargetCode);
    const fusionAction = getLuaRestoreLegalActions(restoredMaterialOpen, 0).find(
      (action) => action.type === "fusionSummon" && action.uid === fusion.uid && action.materialUids.includes(materialAdLibitum.uid) && action.materialUids.includes(partner.uid),
    );
    expect(fusionAction, JSON.stringify(getLuaRestoreLegalActions(restoredMaterialOpen, 0), null, 2)).toBeDefined();
    fusionSummonDuelCard(restoredMaterialOpen.session.state, 0, fusion.uid, [materialAdLibitum.uid, partner.uid]);
    expect(restoredMaterialOpen.session.state.cards.find((card) => card.uid === materialAdLibitum.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.material | duelReason.fusion,
      reasonPlayer: 0,
    });
    expect(restoredMaterialOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-1108",
        eventCardUid: materialAdLibitum.uid,
        eventCode: eventBeMaterial,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.fusion,
        eventReasonCardUid: fusion.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: materialAdLibitum.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredMaterialOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === materialAdLibitum.uid && action.effectId === "lua-2-1108");
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, revive!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === reviveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: materialAdLibitum.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "usedAsMaterial", eventCode: eventBeMaterial, eventCardUid: materialAdLibitum.uid, eventUids: undefined, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: fusion.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: eventBeMaterial, eventCardUid: partner.uid, eventUids: undefined, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: fusion.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: fusion.uid, eventUids: undefined, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: reviveTarget.uid, eventUids: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveTarget.uid, eventUids: [reviveTarget.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: materialAdLibitum.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ad Libitum of Despia");
  expect(script).toContain("s.listed_series={SET_DESPIA}");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.HasLevel),tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(sc:GetLevel()*100)");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return (r&REASON_FUSION)==REASON_FUSION");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE|LOCATION_REMOVED,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: adLibitumCode, name: "Ad Libitum of Despia", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeDark, setcodes: [setDespia], level: 8, attack: 1500, defense: 2000 },
    { code: levelFourCode, name: "Ad Libitum Level Four", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1200 },
    { code: opponentLevelEightCode, name: "Ad Libitum Opponent Level Eight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 8, attack: 2100, defense: 2100 },
    { code: despiaReviveTargetCode, name: "Ad Libitum Despia Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeDark, setcodes: [setDespia], level: 4, attack: 1100, defense: 1100 },
    { code: fusionPartnerCode, name: "Ad Libitum Fusion Partner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: fusionCode, name: "Ad Libitum Fusion Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 8, attack: 2500, defense: 2500, fusionMaterials: [adLibitumCode, fusionPartnerCode] },
  ];
}

function createRestoredSession(
  { reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 81555617, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [adLibitumCode, levelFourCode, despiaReviveTargetCode, fusionPartnerCode], extra: [fusionCode] }, 1: { main: [opponentLevelEightCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, adLibitumCode), 0);
  moveFaceUpAttack(session, requireCard(session, levelFourCode), 0);
  moveFaceUpAttack(session, requireCard(session, opponentLevelEightCode), 1);
  moveDuelCard(session.state, requireCard(session, despiaReviveTargetCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, fusionPartnerCode), 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(adLibitumCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
