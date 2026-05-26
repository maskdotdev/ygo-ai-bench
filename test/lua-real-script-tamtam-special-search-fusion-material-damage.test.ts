import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, fusionSummonDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const tamtamCode = "79757784";
const polymerizationCode = "24094653";
const melodiousCode = "797577840";
const partnerCode = "797577841";
const fusionCode = "797577842";
const decoyCode = "797577843";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const setMelodious = 0x9b;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts)("Lua real script Tamtam special search fusion material damage", () => {
  it("restores special-summon Polymerization search and Fusion-material ATK damage trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tamtamCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DAMAGE+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("return r==REASON_FUSION and e:GetHandler():IsLocation(LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectTarget(tp,s.damfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("tc:UpdateAttack(-500,RESET_EVENT|RESETS_STANDARD,e:GetHandler())==-500");
    expect(script).toContain("Duel.Damage(1-tp,500,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: tamtamCode, name: "Tamtam the Melodious Diva", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMelodious], level: 4, attack: 1000, defense: 1000 },
      { code: polymerizationCode, name: "Polymerization", kind: "spell", typeFlags: typeSpell },
      { code: melodiousCode, name: "Tamtam Melodious Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMelodious], level: 4, attack: 1600, defense: 1000 },
      { code: partnerCode, name: "Tamtam Fusion Partner", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: fusionCode, name: "Tamtam Fusion Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 6, attack: 2200, defense: 1800, fusionMaterials: [tamtamCode, partnerCode] },
      { code: decoyCode, name: "Tamtam Search Decoy", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 79757784, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tamtamCode, polymerizationCode, melodiousCode, partnerCode, decoyCode], extra: [fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const tamtam = requireCard(session.state.cards, tamtamCode);
    const polymerization = requireCard(session.state.cards, polymerizationCode);
    const melodious = requireCard(session.state.cards, melodiousCode);
    const partner = requireCard(session.state.cards, partnerCode);
    const fusion = requireCard(session.state.cards, fusionCode);
    const decoy = requireCard(session.state.cards, decoyCode);
    moveDuelCard(session.state, tamtam.uid, "hand", 0);
    moveFaceUpAttack(session, melodious, 0);
    moveFaceUpAttack(session, partner, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tamtamCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    specialSummonDuelCard(session.state, tamtam.uid, 0);
    const restoredSearchTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSearchTrigger);
    expectRestoredLegalActions(restoredSearchTrigger, 0);
    expect(restoredSearchTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1102",
        sourceUid: tamtam.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventCode: 1102,
        eventCardUid: tamtam.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearchTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tamtam.uid);
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearchTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in searchTrigger! ? searchTrigger!.operationInfos : []) ?? []).toEqual([]);
    applyLuaRestoreAndAssert(restoredSearchTrigger, searchTrigger!);
    expect(restoredSearchTrigger.session.state.chain).toEqual([]);
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === polymerization.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: tamtam.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchTrigger.host.messages).toEqual([`confirmed 1: ${polymerizationCode}`]);

    fusionSummonDuelCard(restoredSearchTrigger.session.state, 0, fusion.uid, [tamtam.uid, partner.uid]);
    const restoredMaterialTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSearchTrigger.session), workspace, reader);
    expectCleanRestore(restoredMaterialTrigger);
    expectRestoredLegalActions(restoredMaterialTrigger, 0);
    expect(restoredMaterialTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-2-1108",
        sourceUid: tamtam.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventCode: eventBeMaterial,
        eventCardUid: tamtam.uid,
        eventReason: duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusion.uid,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const damageTrigger = getLuaRestoreLegalActions(restoredMaterialTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tamtam.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredMaterialTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in damageTrigger! ? damageTrigger!.operationInfos : []) ?? []).toEqual([]);
    applyLuaRestoreAndAssert(restoredMaterialTrigger, damageTrigger!);
    expect(restoredMaterialTrigger.session.state.chain).toEqual([]);
    const resolvedMelodious = restoredMaterialTrigger.session.state.cards.find((card) => card.uid === melodious.uid);
    expect(currentAttack(resolvedMelodious, restoredMaterialTrigger.session.state)).toBe(1100);
    expect(restoredMaterialTrigger.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredMaterialTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tamtam.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.reason = duelReason.summon;
  card.reasonPlayer = controller;
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
