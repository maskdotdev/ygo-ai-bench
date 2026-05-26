import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const convexCode = "43471513";
const fieldMachineCode = "434715130";
const graveMachineCode = "434715131";
const wrongRaceCode = "434715132";
const wrongAttributeCode = "434715133";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasConvexScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${convexCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasConvexScript)("Lua real script Convex Knight summon level send stat", () => {
  it("restores hand Special Summon into optional Machine Level copy and Deck EARTH Machine ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${convexCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 43471513, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [convexCode, fieldMachineCode, graveMachineCode, wrongRaceCode, wrongAttributeCode] }, 1: { main: [] } });
    startDuel(session);

    const convex = requireCard(session, convexCode);
    const fieldMachine = requireCard(session, fieldMachineCode);
    const graveMachine = requireCard(session, graveMachineCode);
    const wrongRace = requireCard(session, wrongRaceCode);
    const wrongAttribute = requireCard(session, wrongAttributeCode);
    moveDuelCard(session.state, convex.uid, "hand", 0);
    moveFaceUpAttack(session, fieldMachine, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(convexCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === convex.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);

    const convexAfterSummon = restoredOpen.session.state.cards.find((card) => card.uid === convex.uid);
    expect(restoredOpen.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 695544210, returned: true }]);
    expect(convexAfterSummon).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: convex.uid,
      reasonEffectId: 1,
    });
    expect(currentLevel(convexAfterSummon, restoredOpen.session.state)).toBe(7);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === convex.uid && effect.code === 131).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 131, reset: { flags: 33492992 }, sourceUid: convex.uid, value: 7 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === convex.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: convex.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: convex.uid,
        eventReasonEffectId: 1,
        eventUids: [convex.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);

    const restoredStatOpen = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredStatOpen);
    expectRestoredLegalActions(restoredStatOpen, 0);
    const sendBoost = getLuaRestoreLegalActions(restoredStatOpen, 0).find((action) => action.type === "activateEffect" && action.uid === convex.uid);
    expect(sendBoost, JSON.stringify(getLuaRestoreLegalActions(restoredStatOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStatOpen, sendBoost!);

    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === graveMachine.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: convex.uid,
      reasonEffectId: 2,
    });
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === wrongRace.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === wrongAttribute.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentLevel(restoredStatOpen.session.state.cards.find((card) => card.uid === convex.uid), restoredStatOpen.session.state)).toBe(7);
    expect(currentAttack(restoredStatOpen.session.state.cards.find((card) => card.uid === convex.uid), restoredStatOpen.session.state)).toBe(2200);
    expect(restoredStatOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === convex.uid)).toMatchObject({ attackModifier: 500 });
    expect(restoredStatOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === graveMachine.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveMachine.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: convex.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredAfterBoost = restoreDuelWithLuaScripts(serializeDuel(restoredStatOpen.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredAfterBoost);
    expectRestoredLegalActions(restoredAfterBoost, 0);
    expect(currentAttack(restoredAfterBoost.session.state.cards.find((card) => card.uid === convex.uid), restoredAfterBoost.session.state)).toBe(2200);
    expect(currentLevel(restoredAfterBoost.session.state.cards.find((card) => card.uid === convex.uid), restoredAfterBoost.session.state)).toBe(7);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_LVCHANGE)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_LVCHANGE,c,1,tp,0)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)>0");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.HintSelection(sc)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,c,1,tp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(sc,REASON_EFFECT)");
  expect(script).toContain("c:UpdateAttack(sc:GetLevel()*100,RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: convexCode, name: "Convex Knight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1700, defense: 1500 },
    { code: fieldMachineCode, name: "Convex Knight Level Copy Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 7, attack: 1000, defense: 1000 },
    { code: graveMachineCode, name: "Convex Knight EARTH Machine Send", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 5, attack: 1200, defense: 1000 },
    { code: wrongRaceCode, name: "Convex Knight EARTH Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 9, attack: 1800, defense: 1000 },
    { code: wrongAttributeCode, name: "Convex Knight LIGHT Machine Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 8, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
