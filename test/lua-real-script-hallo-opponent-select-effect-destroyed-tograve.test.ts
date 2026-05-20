import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const halloCode = "54611591";
const fiendACode = "546115910";
const fiendBCode = "546115911";
const warriorCode = "546115912";
const opponentMonsterCode = "546115913";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceFiend = 0x8;

describe.skipIf(!hasUpstreamScripts)("Lua real script Hallo opponent SelectEffect destroyed to grave", () => {
  it("restores opponent-chosen summon branch and destroyed trigger SendtoGrave", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${halloCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("local e2=e1:Clone()");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsRace,tp,LOCATION_GRAVE,0,nil,RACE_FIEND)");
    expect(script).toContain("Duel.SelectEffect(1-tp,");
    expect(script).toContain("c:UpdateAttack(ct*800)");
    expect(script).toContain("Duel.Damage(1-tp,ct*500,REASON_EFFECT)");
    expect(script).toContain("e3:SetCategory(CATEGORY_TOGRAVE)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("e3:SetCondition(function(e) return e:GetHandler():IsReason(REASON_BATTLE|REASON_EFFECT) end)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToGrave,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.HintSelection(g)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: halloCode, name: "Hallo, the Spirit of Tricks", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
      { code: fiendACode, name: "Hallo Fiend A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
      { code: fiendBCode, name: "Hallo Fiend B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1100, defense: 1000 },
      { code: warriorCode, name: "Hallo Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1200, defense: 1000 },
      { code: opponentMonsterCode, name: "Hallo Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1300, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 54611591, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [halloCode, fiendACode, fiendBCode, warriorCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const hallo = requireCard(session, halloCode);
    const fiendA = requireCard(session, fiendACode);
    const fiendB = requireCard(session, fiendBCode);
    const warrior = requireCard(session, warriorCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, hallo.uid, "hand", 0);
    moveDuelCard(session.state, fiendA.uid, "graveyard", 0);
    moveDuelCard(session.state, fiendB.uid, "graveyard", 0);
    moveDuelCard(session.state, warrior.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1);
    opponentMonster.position = "faceUpAttack";
    opponentMonster.faceUp = true;
    opponentMonster.reason = duelReason.summon;
    opponentMonster.reasonPlayer = 1;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(halloCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === hallo.uid);
    expect(summon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: hallo.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: hallo.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const statTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === hallo.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in statTrigger! ? statTrigger!.operationInfos : []) ?? []).toEqual([]);
    applyLuaRestoreAndAssert(restoredTriggerWindow, statTrigger!);

    const restoredStatResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), workspace, reader);
    expectCleanRestore(restoredStatResolved);
    expectRestoredLegalActions(restoredStatResolved, 0);
    const statResolvedHallo = restoredStatResolved.session.state.cards.find((card) => card.uid === hallo.uid);
    expect(statResolvedHallo).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(currentAttack(statResolvedHallo, restoredStatResolved.session.state)).toBe(2600);
    expect(restoredStatResolved.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredTriggerWindow.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 1, options: [1, 2], descriptions: [873785458, 873785459], returned: 1 },
    ]);
    expect(restoredStatResolved.host.promptDecisions).toEqual([]);

    const destroyedHallo = destroyDuelCard(
      restoredStatResolved.session.state,
      hallo.uid,
      0,
      duelReason.effect | duelReason.destroy,
      1,
      "graveyard",
      { eventReasonCardUid: opponentMonster.uid, eventReasonEffectId: 77 },
    );
    expect(destroyedHallo).toMatchObject({ location: "graveyard", reason: duelReason.effect | duelReason.destroy });
    expect(restoredStatResolved.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-3-1029",
        sourceUid: hallo.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: hallo.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: opponentMonster.uid,
        eventReasonEffectId: 77,
        eventReasonPlayer: 1,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 3 },
      },
    ]);

    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredStatResolved.session), workspace, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    const toGraveTrigger = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hallo.uid);
    expect(toGraveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in toGraveTrigger! ? toGraveTrigger!.operationInfos : []) ?? []).toEqual([]);
    applyLuaRestoreAndAssert(restoredDestroyedTrigger, toGraveTrigger!);

    const restoredToGraveResolved = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyedTrigger.session), workspace, reader);
    expectCleanRestore(restoredToGraveResolved);
    expectRestoredLegalActions(restoredToGraveResolved, 0);
    expect(restoredToGraveResolved.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: hallo.uid,
      reasonEffectId: 3,
    });
    expect(restoredToGraveResolved.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === opponentMonster.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: opponentMonster.uid,
        eventReason: duelReason.effect,
        eventReasonCardUid: hallo.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
