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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hierophantCode = "3376703";
const arcanaDeckCode = "33767030";
const responderCode = "33767031";
const hasHierophantScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hierophantCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setArcanaForce = 0x5;
const categoryCoinSpecialSummon = 0x1000200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHierophantScript)("Lua real script Arcana Force Hierophant coin chain limit", () => {
  it("restores hand self-discard limiter registration and summon TossCoin into Deck Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hierophantCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hierophantCode, arcanaDeckCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const hierophant = requireCard(session, hierophantCode);
    const arcanaDeck = requireCard(session, arcanaDeckCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, hierophant.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hierophantCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === hierophant.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: undefined, event: "ignition", range: ["hand"], triggerEvent: undefined },
      { category: categoryCoinSpecialSummon, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: categoryCoinSpecialSummon, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryCoinSpecialSummon, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
    ]);

    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === hierophant.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, ignition!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === hierophant.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: hierophant.uid,
      reasonEffectId: 1,
    });
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === hierophant.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: undefined, event: "ignition", range: ["hand"], triggerEvent: undefined },
      { code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { code: 1100, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
      { code: 1102, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
      { code: 1101, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
      { code: 1026, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
      { code: undefined, event: "ignition", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
    ]);

    moveDuelCard(restoredOpen.session.state, hierophant.uid, "monsterZone", 0);
    const summonedHierophant = restoredOpen.session.state.cards.find((card) => card.uid === hierophant.uid)!;
    summonedHierophant.sequence = 0;
    summonedHierophant.faceUp = true;
    summonedHierophant.position = "faceUpAttack";
    const raised = restoredOpen.host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${hierophantCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Duel.RaiseEvent(c,EVENT_SUMMON_SUCCESS,nil,REASON_SUMMON,0,0,0)
      `,
      "arcana-force-hierophant-summon-success.lua",
    );
    expect(raised.ok, raised.error).toBe(true);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-2-1100",
        sourceUid: hierophant.uid,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: hierophant.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventReasonCardUid: hierophant.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [hierophant.uid],
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hierophant.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredTrigger.host.promptDecisions).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === arcanaDeck.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: hierophant.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.host.messages).not.toContain("hierophant responder resolved");
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "normalSummoned", "coinTossed", "specialSummoned"].includes(event.eventName))).toEqual([
      sentToGraveEvent(hierophant.uid),
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: hierophant.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventReasonCardUid: hierophant.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [hierophant.uid],
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hierophant.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: arcanaDeck.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: hierophant.uid,
        eventReasonEffectId: 2,
        eventUids: [arcanaDeck.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force V - The Hierophant");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.SetChainLimitTillChainEnd(function(re,rp,tp) return tp==rp end)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COIN+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e4:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("{b1,aux.GetCoinEffectHintString(COIN_HEADS)}");
  expect(script).toContain("{b2,aux.GetCoinEffectHintString(COIN_TAILS)}");
  expect(script).toContain("coin=Duel.TossCoin(tp,1)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.headsspfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tailsspfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const hierophant = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === hierophantCode);
  expect(hierophant).toBeDefined();
  return [
    hierophant!,
    { code: arcanaDeckCode, name: "Hierophant Deck Arcana Force", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1000, defense: 1000 },
    { code: responderCode, name: "Hierophant Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("hierophant responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sentToGraveEvent(cardUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.cost | duelReason.discard,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
