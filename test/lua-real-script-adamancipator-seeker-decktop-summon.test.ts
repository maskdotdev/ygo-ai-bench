import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const seekerCode = "48519867";
const hasSeekerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${seekerCode}.lua`));
const validRockCode = "48519868";
const tunerRockCode = "48519869";
const highLevelRockCode = "48519870";
const nonRockCode = "48519871";
const spellDecoyCode = "48519872";
const fillerCode = "48519873";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSpell = 0x2;
const raceRock = 0x100;
const raceWarrior = 0x1;
const attributeEarth = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasSeekerScript)("Lua real script Adamancipator Seeker Deck-top summon", () => {
  it("restores Deck-top confirmation, SelectYesNo, excavated Rock Special Summon, and bottom placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${seekerCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>4");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.ConfirmDecktop(tp,5)");
    expect(script).toContain("Duel.GetDecktopGroup(tp,5):Filter(s.filter,nil,e,tp)");
    expect(script).toContain("if #g>0 and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then");
    expect(script).toContain("Duel.DisableShuffleCheck()");
    expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.MoveToDeckBottom(ac,tp)");
    expect(script).toContain("Duel.SortDeckbottom(tp,tp,ac)");

    const cards: DuelCardData[] = [
      { code: seekerCode, name: "Adamancipator Seeker", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceRock, attribute: attributeEarth, level: 2, attack: 1200, defense: 1000 },
      { code: validRockCode, name: "Excavated Non-Tuner Rock", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
      { code: tunerRockCode, name: "Excavated Tuner Rock Decoy", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceRock, attribute: attributeEarth, level: 2, attack: 1000, defense: 1000 },
      { code: highLevelRockCode, name: "Excavated High-Level Rock Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 5, attack: 1800, defense: 1500 },
      { code: nonRockCode, name: "Excavated Non-Rock Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1100 },
      { code: spellDecoyCode, name: "Excavated Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: fillerCode, name: "Deck Filler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 48519867, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [seekerCode, validRockCode, tunerRockCode, highLevelRockCode, nonRockCode, spellDecoyCode, fillerCode] }, 1: { main: [] } });
    startDuel(session);

    const seeker = requireCard(session, seekerCode);
    const validRock = requireCard(session, validRockCode);
    const tunerRock = requireCard(session, tunerRockCode);
    const highLevelRock = requireCard(session, highLevelRockCode);
    const nonRock = requireCard(session, nonRockCode);
    const spellDecoy = requireCard(session, spellDecoyCode);
    const filler = requireCard(session, fillerCode);
    moveDuelCard(session.state, seeker.uid, "monsterZone", 0).position = "faceUpAttack";
    setDeckSequence(validRock, 0);
    setDeckSequence(tunerRock, 1);
    setDeckSequence(highLevelRock, 2);
    setDeckSequence(nonRock, 3);
    setDeckSequence(spellDecoy, 4);
    setDeckSequence(filler, 5);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(seekerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === seeker.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 776317874, returned: true });
    expect(restoredOpen.host.messages).toContain(`confirmed decktop 0: ${validRockCode},${tunerRockCode},${highLevelRockCode},${nonRockCode},${spellDecoyCode}`);
    expect(restoredOpen.session.state.shuffleCheckDisabled).toBe(true);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === validRock.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: seeker.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === filler.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tunerRock.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 1 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === highLevelRock.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 2 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === nonRock.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 3 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 4 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["confirmed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: validRock.uid,
        eventPlayer: 0,
        eventValue: 5,
        eventUids: [validRock.uid, tunerRock.uid, highLevelRock.uid, nonRock.uid, spellDecoy.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: validRock.uid,
        eventUids: [validRock.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: seeker.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.location = "deck";
  card.controller = 0;
  card.sequence = sequence;
  card.faceUp = false;
  card.position = "faceDown";
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
