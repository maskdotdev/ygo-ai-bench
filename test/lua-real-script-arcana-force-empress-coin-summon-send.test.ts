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
const empressCode = "35781051";
const arcanaHandCode = "357810510";
const opponentSummonCode = "357810511";
const sendCostCode = "357810512";
const hasEmpressScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${empressCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setArcanaForce = 0x5;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasEmpressScript)("Lua real script Arcana Force Empress coin summon send", () => {
  it("restores Arcana coin-result registration into opponent-summon follow-up effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${empressCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [empressCode, arcanaHandCode, sendCostCode] }, 1: { main: [opponentSummonCode] } });
    startDuel(session);

    const empress = requireCard(session, empressCode);
    const arcanaHand = requireCard(session, arcanaHandCode);
    const opponentSummon = requireCard(session, opponentSummonCode);
    const sendCost = requireCard(session, sendCostCode);
    moveFaceUpAttack(session, empress, 0, 0);
    moveDuelCard(session.state, arcanaHand.uid, "hand", 0).sequence = 0;
    moveDuelCard(session.state, sendCost.uid, "hand", 0).sequence = 1;
    moveDuelCard(session.state, opponentSummon.uid, "hand", 1).sequence = 0;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(empressCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const raised = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${empressCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Duel.RaiseEvent(c,EVENT_SUMMON_SUCCESS,nil,REASON_SUMMON,0,0,0)
      `,
      "arcana-force-empress-summon-success.lua",
    );
    expect(raised.ok, raised.error).toBe(true);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 0);
    const initialTrigger = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "activateTrigger" && action.uid === empress.uid);
    expect(initialTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestored(restoredInitial, initialTrigger!);
    passRestoredChain(restoredInitial);

    expect(restoredInitial.session.state.lastCoinResults).toEqual([1]);
    expect(restoredInitial.session.state.effects.filter((effect) => effect.sourceUid === empress.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x1000000, code: 1100, event: "trigger", range: allLocations, triggerEvent: "normalSummoned" },
      { category: 0x1000000, code: 1102, event: "trigger", range: allLocations, triggerEvent: "specialSummoned" },
      { category: 0x1000000, code: 1101, event: "trigger", range: allLocations, triggerEvent: "flipSummoned" },
      { category: 0x200, code: 1100, event: "trigger", range: ["monsterZone"], triggerEvent: "normalSummoned" },
      { category: 0x200, code: 1106, event: "trigger", range: ["monsterZone"], triggerEvent: "monsterSet" },
      { category: 0x20, code: 1100, event: "trigger", range: ["monsterZone"], triggerEvent: "normalSummoned" },
      { category: 0x20, code: 1106, event: "trigger", range: ["monsterZone"], triggerEvent: "monsterSet" },
    ]);

    restoredInitial.session.state.turnPlayer = 1;
    restoredInitial.session.state.waitingFor = 1;
    const summon = getLuaRestoreLegalActions(restoredInitial, 1).find((action) => action.type === "normalSummon" && action.uid === opponentSummon.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyRestored(restoredInitial, summon!);

    const restoredFollowup = restoredInitial;
    expectCleanRestore(restoredFollowup);
    expectRestoredLegalActions(restoredFollowup, 0);
    expect(restoredFollowup.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-4-1100",
        sourceUid: empress.uid,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: opponentSummon.uid,
        eventPlayer: 1,
        eventReason: duelReason.summon,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "opponentOptional",
      },
    ]);
    const followup = getLuaRestoreLegalActions(restoredFollowup, 0).find((action) => action.type === "activateTrigger" && action.uid === empress.uid);
    expect(followup, JSON.stringify(getLuaRestoreLegalActions(restoredFollowup, 0), null, 2)).toBeDefined();
    applyRestored(restoredFollowup, followup!);
    passRestoredChain(restoredFollowup);

    expect(restoredFollowup.session.state.cards.find((card) => card.uid === arcanaHand.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: empress.uid,
      reasonEffectId: 4,
    });
    expect(restoredFollowup.session.state.cards.find((card) => card.uid === sendCost.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
    expect(restoredFollowup.session.state.eventHistory.filter((event) => ["coinTossed", "normalSummoned", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: empress.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [empress.uid],
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: empress.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: opponentSummon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: arcanaHand.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: empress.uid,
        eventReasonEffectId: 4,
        eventUids: [arcanaHand.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force III - The Empress");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetCode(EVENT_MSET)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOGRAVE)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_HEADS");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_TAILS");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
}

function cards(): DuelCardData[] {
  return [
    { code: empressCode, name: "Arcana Force III - The Empress", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1300, defense: 1300 },
    { code: arcanaHandCode, name: "Empress Arcana Hand", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1000, defense: 1000 },
    { code: opponentSummonCode, name: "Empress Opponent Summon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: sendCostCode, name: "Empress Send Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
