import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const skilledBlueCode = "88901771";
const gaiaCode = "6368038";
const responderCode = "88901772";
const counterSpell = 0x1;
const categoryCounter = 0x800000;
const categorySpecialSummon = 0x200;
const eventChainSolved = 1022;
const eventChaining = 1027;
const effectFlagCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Skilled Blue Magician counter summon", () => {
  it("restores chain counter registration, three-counter release summon, and graveyard SelfBanish counter target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${skilledBlueCode}.lua`);
    expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
    expect(script).toContain("c:SetCounterLimit(COUNTER_SPELL,3)");
    expect(script).toContain("e0:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e0:SetOperation(aux.chainreg)");
    expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVED)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetCost(s.spcost)");
    expect(script).toContain("e:GetHandler():GetCounter(COUNTER_SPELL)==3 and e:GetHandler():IsReleasable()");
    expect(script).toContain("Duel.Release(e:GetHandler(),REASON_COST)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter),tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter,tp,LOCATION_ONFIELD,0,1,1,nil)");
    expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === skilledBlueCode || card.code === gaiaCode),
      { code: responderCode, name: "Skilled Blue Chain Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8890, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [skilledBlueCode, skilledBlueCode, gaiaCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const fieldBlue = requireCard(session, skilledBlueCode, 0);
    const targetBlue = requireCard(session, skilledBlueCode, 1);
    const gaia = requireCard(session, gaiaCode, 0);
    const responder = requireCard(session, responderCode, 0);
    moveFaceUpAttack(session, fieldBlue.uid, 0);
    moveFaceUpAttack(session, targetBlue.uid, 0);
    moveDuelCard(session.state, gaia.uid, "deck", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    expect(addDuelCardCounter(fieldBlue, counterSpell, 3)).toBe(true);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skilledBlueCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.find((effect) => effect.sourceUid === fieldBlue.uid && effect.code === eventChainSolved)).toMatchObject({ code: eventChainSolved, event: "continuous", sourceUid: fieldBlue.uid });
    expect(session.state.effects.find((effect) => effect.sourceUid === fieldBlue.uid && effect.code === eventChaining)).toMatchObject({
      code: eventChaining,
      property: effectFlagCannotDisable,
      sourceUid: fieldBlue.uid,
    });

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summonEffect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fieldBlue.uid);
    expect(summonEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summonEffect!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]).toEqual({
      activationLocation: "graveyard",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-5",
      id: "chain-3",
      operationInfos: [{ category: categorySpecialSummon, count: 1, player: 0, parameter: 19, targetUids: [] }],
      player: 0,
      sourceUid: fieldBlue.uid,
    });
    expectRestoredLegalActions(restoredOpen, 1);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fieldBlue.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonCardUid: fieldBlue.uid,
      reasonEffectId: 5,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === gaia.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: fieldBlue.uid,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === gaia.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gaia.uid,
        eventUids: [gaia.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldBlue.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === fieldBlue.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldBlue.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCardUid: fieldBlue.uid,
      },
    ]);
    expect(getDuelCardCounter(targetBlue, counterSpell)).toBe(0);

    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const counterEffect = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === fieldBlue.uid);
    expect(counterEffect, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, counterEffect!);
    expect(restoredGrave.session.state.chain).toHaveLength(1);
    expect(restoredGrave.session.state.chain[0]).toEqual({
      activationLocation: "banished",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-6",
      id: "chain-9",
      operationInfos: [{ category: categoryCounter, count: 1, player: 0, parameter: counterSpell, targetUids: [] }],
      player: 0,
      sourceUid: fieldBlue.uid,
      targetUids: [targetBlue.uid],
    });
    expectRestoredLegalActions(restoredGrave, 1);
    passRestoredChain(restoredGrave);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === fieldBlue.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
    });
    expect(getDuelCardCounter(restoredGrave.session.state.cards.find((card) => card.uid === targetBlue.uid), counterSpell)).toBe(1);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(getDuelCardCounter(restoredResolved.session.state.cards.find((card) => card.uid === targetBlue.uid), counterSpell)).toBe(1);
  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, player: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function requireCard(session: DuelSession, code: string, index: number) {
  const card = session.state.cards.filter((candidate) => candidate.code === code)[index];
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("skilled blue responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
