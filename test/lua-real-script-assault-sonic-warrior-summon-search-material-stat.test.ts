import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sonicCode = "18711696";
const junkWarriorCode = "60800381";
const synchronSearchCode = "187116960";
const synchroPartnerCode = "187116961";
const synchroResultCode = "187116962";
const allyCode = "187116963";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSonicScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sonicCode}.lua`));
const setSynchron = 0x1017;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const eventBeMaterial = 1108;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSonicScript)("Lua real script Assault Sonic Warrior summon search material stat", () => {
  it("restores hand self-summon into Synchron search and Synchro material field ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sonicCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredHand = createRestoredSonicField({ reader, workspace, scenario: "handSummon" });
    expectCleanRestore(restoredHand);
    expectRestoredLegalActions(restoredHand, 0);
    const handSonic = requireCard(restoredHand.session, sonicCode);
    const searchedSynchron = requireCard(restoredHand.session, synchronSearchCode);
    const handSummon = getLuaRestoreLegalActions(restoredHand, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handSonic.uid
    );
    expect(handSummon, JSON.stringify(getLuaRestoreLegalActions(restoredHand, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHand, handSummon!);
    resolveRestoredChain(restoredHand);

    expect(restoredHand.session.state.cards.find((card) => card.uid === handSonic.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handSonic.uid,
      reasonEffectId: 1,
    });
    expect(restoredHand.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: handSonic.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: handSonic.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredHand.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === handSonic.uid
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchTrigger!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchedSynchron.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: handSonic.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${synchronSearchCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: handSonic.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: handSonic.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: searchedSynchron.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: handSonic.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: searchedSynchron.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: handSonic.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: searchedSynchron.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: handSonic.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    const restoredMaterial = createRestoredSonicField({ reader, workspace, scenario: "synchroMaterial" });
    expectCleanRestore(restoredMaterial);
    expectRestoredLegalActions(restoredMaterial, 0);
    const materialSonic = requireCard(restoredMaterial.session, sonicCode);
    const partner = requireCard(restoredMaterial.session, synchroPartnerCode);
    const synchro = requireCard(restoredMaterial.session, synchroResultCode);
    const ally = requireCard(restoredMaterial.session, allyCode);
    const synchroAction = getLuaRestoreLegalActions(restoredMaterial, 0).find((action) =>
      action.type === "synchroSummon" && action.uid === synchro.uid && action.materialUids.includes(materialSonic.uid) && action.materialUids.includes(partner.uid)
    );
    expect(synchroAction, JSON.stringify(getLuaRestoreLegalActions(restoredMaterial, 0), null, 2)).toBeDefined();
    synchroSummonDuelCard(restoredMaterial.session.state, 0, synchro.uid, [materialSonic.uid, partner.uid]);

    expect(restoredMaterial.session.state.cards.find((card) => card.uid === materialSonic.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.synchro,
      reasonPlayer: 0,
    });
    expect(restoredMaterial.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-4-1108",
        sourceUid: materialSonic.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventPlayer: 0,
        eventCardUid: materialSonic.uid,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredMaterial.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial" && event.eventCardUid === materialSonic.uid)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: materialSonic.uid,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredMaterialTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredMaterial.session), workspace, reader);
    expectCleanRestore(restoredMaterialTrigger);
    expectRestoredLegalActions(restoredMaterialTrigger, 0);
    const materialTrigger = getLuaRestoreLegalActions(restoredMaterialTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === materialSonic.uid
    );
    expect(materialTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredMaterialTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMaterialTrigger, materialTrigger!);
    resolveRestoredChain(restoredMaterialTrigger);

    expect(currentAttack(restoredMaterialTrigger.session.state.cards.find((card) => card.uid === synchro.uid), restoredMaterialTrigger.session.state)).toBe(2700);
    expect(currentAttack(restoredMaterialTrigger.session.state.cards.find((card) => card.uid === ally.uid), restoredMaterialTrigger.session.state)).toBe(1500);
    expect(restoredMaterialTrigger.session.state.effects.filter((effect) => effect.sourceUid === materialSonic.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1073742336 }, sourceUid: materialSonic.uid, targetRange: [4, 0], value: 500 },
    ]);
    expect(restoredMaterialTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSonicField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "handSummon" | "synchroMaterial";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "handSummon" ? 18711696 : 18711697, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [sonicCode, synchronSearchCode, synchroPartnerCode, allyCode], extra: [junkWarriorCode, synchroResultCode] },
    1: { main: [] },
  });
  startDuel(session);
  if (scenario === "handSummon") {
    moveDuelCard(session.state, requireCard(session, sonicCode).uid, "hand", 0);
    moveFaceUpAttack(session, requireCard(session, junkWarriorCode), 0, 0);
  } else {
    moveFaceUpAttack(session, requireCard(session, sonicCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, synchroPartnerCode), 0, 1);
    moveFaceUpAttack(session, requireCard(session, allyCode), 0, 2);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sonicCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Assault Sonic Warrior");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("return (c:IsCode(CARD_JUNK_WARRIOR,CARD_ASSAULT_MODE) or c:ListsCode(CARD_JUNK_WARRIOR,CARD_ASSAULT_MODE)) and c:IsFaceup()");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2a:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2a:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2a:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2b:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return ((c:IsSetCard(SET_SYNCHRON) and c:IsMonster()) or c:IsCode(CARD_ASSAULT_MODE)) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and r==REASON_SYNCHRO");
  expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,3))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: sonicCode, name: "Assault Sonic Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 2, attack: 1000, defense: 1000 },
    { code: junkWarriorCode, name: "Junk Warrior", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeDark, level: 5, attack: 2300, defense: 1300 },
    { code: synchronSearchCode, name: "Assault Sonic Synchron Search", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceWarrior, attribute: attributeEarth, level: 2, attack: 800, defense: 800, setcodes: [setSynchron] },
    { code: synchroPartnerCode, name: "Assault Sonic Synchro Partner", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceWarrior, attribute: attributeEarth, level: 2, attack: 700, defense: 700 },
    { code: synchroResultCode, name: "Assault Sonic Synchro Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2200, defense: 1800 },
    { code: allyCode, name: "Assault Sonic Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
