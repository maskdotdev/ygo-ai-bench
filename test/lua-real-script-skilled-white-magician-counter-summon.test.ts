import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const skilledWhiteCode = "46363422";
const busterBladerCode = "78193831";
const responderCode = "46363423";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceSpellcaster = 0x10;
const raceWarrior = 0x1;
const counterSpell = 0x1;
const categorySpecialSummon = 0x200;
const eventChainSolved = 1022;
const eventChaining = 1027;
const effectFlagCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts)("Lua real script Skilled White Magician counter summon", () => {
  it("restores chain counter registration and three-counter self-release Buster Blader summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${skilledWhiteCode}.lua`);
    expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
    expect(script).toContain("c:SetCounterLimit(COUNTER_SPELL,3)");
    expect(script).toContain("e0:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e0:SetOperation(aux.chainreg)");
    expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVED)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e:GetHandler():GetCounter(COUNTER_SPELL)==3 and e:GetHandler():IsReleasable()");
    expect(script).toContain("Duel.Release(e:GetHandler(),REASON_COST)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter),tp,LOCATION_DECK|LOCATION_HAND|LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: skilledWhiteCode, name: "Skilled White Magician", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, level: 4, attack: 1700, defense: 1900 },
      { code: busterBladerCode, name: "Buster Blader", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 7, attack: 2600, defense: 2300 },
      { code: responderCode, name: "Skilled White Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 46363422, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [skilledWhiteCode, busterBladerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const skilledWhite = requireCard(session, skilledWhiteCode);
    const busterBlader = requireCard(session, busterBladerCode);
    const responder = requireCard(session, responderCode);
    const movedWhite = moveDuelCard(session.state, skilledWhite.uid, "monsterZone", 0);
    movedWhite.position = "faceUpAttack";
    movedWhite.faceUp = true;
    moveDuelCard(session.state, busterBlader.uid, "deck", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    expect(addDuelCardCounter(movedWhite, counterSpell, 3)).toBe(true);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skilledWhiteCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.find((effect) => effect.sourceUid === skilledWhite.uid && effect.code === eventChaining)).toMatchObject({
      code: eventChaining,
      event: "continuous",
      property: effectFlagCannotDisable,
      sourceUid: skilledWhite.uid,
    });
    expect(session.state.effects.find((effect) => effect.sourceUid === skilledWhite.uid && effect.code === eventChainSolved)).toMatchObject({
      code: eventChainSolved,
      event: "continuous",
      sourceUid: skilledWhite.uid,
    });

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summonEffect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === skilledWhite.uid);
    expect(summonEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summonEffect!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-5",
        id: "chain-3",
        operationInfos: [{ category: categorySpecialSummon, count: 0, player: 0, parameter: 19, targetUids: [] }],
        player: 0,
        sourceUid: skilledWhite.uid,
      },
    ]);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === skilledWhite.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonCardUid: skilledWhite.uid,
      reasonEffectId: 5,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === busterBlader.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: skilledWhite.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === skilledWhite.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: skilledWhite.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCardUid: skilledWhite.uid,
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === busterBlader.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: busterBlader.uid,
        eventUids: [busterBlader.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: skilledWhite.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.host.messages).not.toContain("skilled white responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("skilled white responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

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
