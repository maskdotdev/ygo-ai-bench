import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const doctorCode = "51020079";
const releaseTunerCode = "51020080";
const reviveCode = "51020081";
const wrongLevelCode = "51020082";
const wrongAttributeCode = "51020083";
const hasDoctorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${doctorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceMachine = 0x20;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasDoctorScript)("Lua real script Cyborg Doctor release Tuner revive", () => {
  it("restores target-time Tuner release cost into matching Level and Attribute Graveyard revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${doctorCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.rfilter,1,false,nil,nil,e,tp,ft)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.rfilter,1,1,false,nil,nil,e,tp,ft)");
    expect(script).toContain("c:IsType(TYPE_TUNER)");
    expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp,c:GetLevel(),c:GetAttribute())");
    expect(script).toContain("Duel.Release(rg,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp,lv,att)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: doctorCode, name: "Cyborg Doctor", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1500, defense: 1700 },
      { code: releaseTunerCode, name: "Cyborg Doctor LIGHT Level 3 Tuner Cost", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceMachine, attribute: attributeLight, level: 3, attack: 1000, defense: 1000 },
      { code: reviveCode, name: "Cyborg Doctor Matching Revive", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 3, attack: 1200, defense: 1000 },
      { code: wrongLevelCode, name: "Cyborg Doctor Wrong Level Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
      { code: wrongAttributeCode, name: "Cyborg Doctor Wrong Attribute Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 3, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 51020079, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [doctorCode, releaseTunerCode, reviveCode, wrongLevelCode, wrongAttributeCode] }, 1: { main: [] } });
    startDuel(session);

    const doctor = requireCard(session, doctorCode);
    const releaseTuner = requireCard(session, releaseTunerCode);
    const revive = requireCard(session, reviveCode);
    const wrongLevel = requireCard(session, wrongLevelCode);
    const wrongAttribute = requireCard(session, wrongAttributeCode);
    moveMonster(session, doctor.uid, 0);
    moveMonster(session, releaseTuner.uid, 1);
    moveDuelCard(session.state, revive.uid, "graveyard", 0);
    moveDuelCard(session.state, wrongLevel.uid, "graveyard", 0);
    moveDuelCard(session.state, wrongAttribute.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doctorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === doctor.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === releaseTuner.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonCardUid: doctor.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.host.promptDecisions).toEqual([]);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: doctor.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === wrongLevel.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === wrongAttribute.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === releaseTuner.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: doctor.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 3 },
        eventCardUid: releaseTuner.uid,
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === revive.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: revive.uid,
        eventUids: [revive.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: doctor.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, uid: string, sequence: number): void {
  const moved = moveDuelCard(session.state, uid, "monsterZone", 0);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
