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
const catapultCode = "64898834";
const hasCatapultScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${catapultCode}.lua`));
const tunerCode = "64898835";
const nonTunerCode = "64898836";
const highLevelTunerCode = "64898837";
const offSetTunerCode = "64898838";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceMachine = 0x20;
const attributeEarth = 0x8;
const setTg = 0x27;

describe.skipIf(!hasUpstreamScripts || !hasCatapultScript)("Lua real script T.G. Catapult Dragon hand Tuner summon", () => {
  it("restores no-cost ignition hand T.G. low-Level Tuner Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${catapultCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsSetCard(SET_TG) and c:IsLevelBelow(3) and c:IsType(TYPE_TUNER)");
    expect(script).toContain("and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_HAND,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: catapultCode, name: "T.G. Catapult Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 2, attack: 900, defense: 1300, setcodes: [setTg] },
      { code: tunerCode, name: "T.G. Hand Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceMachine, attribute: attributeEarth, level: 2, attack: 800, defense: 800, setcodes: [setTg] },
      { code: nonTunerCode, name: "T.G. Non-Tuner Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 2, attack: 1000, defense: 1000, setcodes: [setTg] },
      { code: highLevelTunerCode, name: "T.G. High-Level Tuner Decoy", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000, setcodes: [setTg] },
      { code: offSetTunerCode, name: "Off-Set Tuner Decoy", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceMachine, attribute: attributeEarth, level: 2, attack: 900, defense: 900, setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 64898834, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [catapultCode, tunerCode, nonTunerCode, highLevelTunerCode, offSetTunerCode] }, 1: { main: [] } });
    startDuel(session);

    const catapult = requireCard(session, catapultCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const highLevelTuner = requireCard(session, highLevelTunerCode);
    const offSetTuner = requireCard(session, offSetTunerCode);
    moveDuelCard(session.state, catapult.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, tuner.uid, "hand", 0);
    moveDuelCard(session.state, nonTuner.uid, "hand", 0);
    moveDuelCard(session.state, highLevelTuner.uid, "hand", 0);
    moveDuelCard(session.state, offSetTuner.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(catapultCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === catapult.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: catapult.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === nonTuner.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === highLevelTuner.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === offSetTuner.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === tuner.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: tuner.uid,
        eventUids: [tuner.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: catapult.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
