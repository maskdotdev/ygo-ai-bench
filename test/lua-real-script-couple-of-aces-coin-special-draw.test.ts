import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const coupleCode = "26259179";
const drawOneCode = "262591790";
const drawTwoCode = "262591791";
const hasCoupleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${coupleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categorySpecialSummon = 0x200;
const categoryDraw = 0x10000;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasCoupleScript)("Lua real script Couple of Aces coin special draw", () => {
  it("restores hand ignition coin summon into its special-summon draw trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${coupleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coupleCode, drawOneCode, drawTwoCode] }, 1: { main: [] } });
    startDuel(session);

    const couple = requireCard(session, coupleCode);
    const drawOne = requireCard(session, drawOneCode);
    const drawTwo = requireCard(session, drawTwoCode);
    moveDuelCard(session.state, couple.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(coupleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === couple.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCoin | categorySpecialSummon, code: undefined, countLimit: 1, event: "ignition", range: ["hand"], triggerEvent: undefined },
      { category: categoryDraw, code: 1102, countLimit: undefined, event: "trigger", range: allLocations, triggerEvent: "specialSummoned" },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === couple.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === couple.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: couple.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-2-1102",
        sourceUid: couple.uid,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: couple.uid,
        eventPlayer: 0,
        eventUids: [couple.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: couple.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === couple.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === drawOne.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === drawTwo.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["coinTossed", "specialSummoned", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: couple.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: couple.uid,
        eventUids: [couple.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: couple.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawTwo.uid,
        eventPlayer: 0,
        eventValue: 2,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: couple.uid,
        eventReasonEffectId: 2,
        eventUids: [drawTwo.uid, drawOne.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Couple of Aces");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCountLimit(1,id)");
  expect(script).toContain("local res=Duel.TossCoin(tp,1)");
  expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SpecialSummon(c,1,tp,1-tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DRAW)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e:GetHandler():IsSummonType(SUMMON_TYPE_SPECIAL+1)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(2)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: coupleCode, name: "Couple of Aces", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 100, defense: 100 },
    { code: drawOneCode, name: "Couple of Aces Draw One", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: drawTwoCode, name: "Couple of Aces Draw Two", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
