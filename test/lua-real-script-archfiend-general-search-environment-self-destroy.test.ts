import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const archfiendGeneralCode = "48675364";
const pandemoniumCode = "94585852";
const decoyCode = "48675365";
const dummySpellCode = "48675366";
const responderCode = "48675367";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Archfiend General search and environment self-destroy", () => {
  it("restores self-discard GetFirstMatchingCard search and Pandemonium-gated EFFECT_SELF_DESTROY", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${archfiendGeneralCode}.lua`);
    expect(script).toContain("e1:SetCost(Cost.SelfDiscardToGrave)");
    expect(script).toContain("return c:IsCode(94585852) and c:IsAbleToHand()");
    expect(script).toContain("Duel.GetFirstMatchingCard(s.filter,tp,LOCATION_DECK,0,nil)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
    expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e2:SetCode(EFFECT_SELF_DESTROY)");
    expect(script).toContain("return not Duel.IsEnvironment(94585852)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === archfiendGeneralCode || card.code === pandemoniumCode),
      { code: decoyCode, name: "Archfiend General Search Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: dummySpellCode, name: "Archfiend General Dummy Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Archfiend General Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${dummySpellCode}.lua`) return dummySpellScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const text = workspace.readScript(name);
        if (text === undefined) throw new Error(`Missing script ${name}`);
        return text;
      },
    };

    const search = createRestoredSearchWindow(reader, source, workspace);
    expectCleanRestore(search);
    expectRestoredLegalActions(search, 0);
    const handGeneral = requireCard(search.session, archfiendGeneralCode);
    const pandemonium = requireCard(search.session, pandemoniumCode);
    const searchDecoy = requireCard(search.session, decoyCode);
    const responder = requireCard(search.session, responderCode);
    const activation = getLuaRestoreLegalActions(search, 0).find((action) => action.type === "activateEffect" && action.uid === handGeneral.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(search, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(search, activation!);
    expect(search.session.state.chain).toHaveLength(1);
    expect(search.session.state.chain[0]!.operationInfos).toEqual([{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }]);

    const searchChain = restoreDuelWithLuaScripts(serializeDuel(search.session), source, reader);
    expectCleanRestore(searchChain);
    expectRestoredLegalActions(searchChain, 1);
    expect(getLuaRestoreLegalActions(searchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(searchChain, 1);
    expect(searchChain.session.state.cards.find((card) => card.uid === handGeneral.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(getLuaRestoreLegalActions(searchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(false);
    expect(searchChain.host.messages).not.toContain("archfiend general responder resolved");
    expect(searchChain.host.messages).toContain(`confirmed 1: ${pandemoniumCode}`);
    expect(searchChain.session.state.cards.find((card) => card.uid === pandemonium.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: handGeneral.uid,
      reasonEffectId: 1,
    });
    expect(searchChain.session.state.cards.find((card) => card.uid === searchDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(searchChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToGraveEvent(handGeneral.uid),
      sentToHandEvent(pandemonium.uid, handGeneral.uid),
      confirmedEvent(pandemonium.uid, handGeneral.uid),
      sentToHandConfirmedEvent(pandemonium.uid, handGeneral.uid),
    ]);

    const protectedByPandemonium = createRestoredSelfDestroyWindow(reader, source, workspace, true);
    expectCleanRestore(protectedByPandemonium);
    expectRestoredLegalActions(protectedByPandemonium, 0);
    const protectedGeneral = requireCard(protectedByPandemonium.session, archfiendGeneralCode);
    const protectedDummy = requireCard(protectedByPandemonium.session, dummySpellCode);
    expectSelfDestroyEffect(protectedByPandemonium.session, protectedGeneral.uid);
    expect(protectedByPandemonium.host.loadScript(environmentProbeScript(archfiendGeneralCode, pandemoniumCode), "archfiend-general-pandemonium-active.lua").ok).toBe(true);
    expect(protectedByPandemonium.host.messages).toContain("archfiend environment active true");
    activateAndResolveDummySpell(protectedByPandemonium, protectedDummy.uid);
    expect(protectedByPandemonium.session.state.cards.find((card) => card.uid === protectedGeneral.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(protectedByPandemonium.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === protectedGeneral.uid)).toEqual([]);

    const unprotected = createRestoredSelfDestroyWindow(reader, source, workspace, false);
    expectCleanRestore(unprotected);
    expectRestoredLegalActions(unprotected, 0);
    const unprotectedGeneral = requireCard(unprotected.session, archfiendGeneralCode);
    const unprotectedDummy = requireCard(unprotected.session, dummySpellCode);
    expectSelfDestroyEffect(unprotected.session, unprotectedGeneral.uid);
    expect(unprotected.host.loadScript(environmentProbeScript(archfiendGeneralCode, pandemoniumCode), "archfiend-general-pandemonium-absent.lua").ok).toBe(true);
    expect(unprotected.host.messages).toContain("archfiend environment active false");
    activateAndResolveDummySpell(unprotected, unprotectedDummy.uid);
    expect(unprotected.session.state.cards.find((card) => card.uid === unprotectedGeneral.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: unprotectedGeneral.uid,
      reasonEffectId: 2,
    });
    expect(unprotected.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === unprotectedGeneral.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: unprotectedGeneral.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: unprotectedGeneral.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function createRestoredSearchWindow(
  reader: ReturnType<typeof createCardReader>,
  source: { readScript(name: string): string },
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 48675364, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [archfiendGeneralCode, pandemoniumCode, decoyCode] }, 1: { main: [responderCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, archfiendGeneralCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, responderCode).uid, "hand", 1);
  session.state.turn = 2;
  session.state.turnPlayer = 0;
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(archfiendGeneralCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredSelfDestroyWindow(
  reader: ReturnType<typeof createCardReader>,
  source: { readScript(name: string): string },
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  withPandemonium: boolean,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: withPandemonium ? 48675365 : 48675366, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [archfiendGeneralCode, pandemoniumCode, dummySpellCode] }, 1: { main: [responderCode] } });
  startDuel(session);
  const general = requireCard(session, archfiendGeneralCode);
  const pandemonium = requireCard(session, pandemoniumCode);
  moveDuelCard(session.state, general.uid, "monsterZone", 0);
  general.faceUp = true;
  general.position = "faceUpAttack";
  if (withPandemonium) {
    const field = moveDuelCard(session.state, pandemonium.uid, "spellTrapZone", 0);
    field.faceUp = true;
    field.position = "faceUpAttack";
  }
  moveDuelCard(session.state, requireCard(session, dummySpellCode).uid, "hand", 0);
  session.state.turn = 2;
  session.state.turnPlayer = 0;
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(archfiendGeneralCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(dummySpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function activateAndResolveDummySpell(restored: ReturnType<typeof restoreDuelWithLuaScripts>, dummyUid: string): void {
  const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === dummyUid);
  expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, activate!);
  if (restored.session.state.chain.length === 0) {
    expect(restored.host.messages).toContain("archfiend general dummy resolved");
    return;
  }
  expectRestoredLegalActions(restored, 1);
  const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
  expect(pass).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
  expect(restored.session.state.chain).toHaveLength(0);
  expect(restored.host.messages).toContain("archfiend general dummy resolved");
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}

function expectSelfDestroyEffect(session: DuelSession, uid: string): void {
  expect(session.state.effects.find((effect) => effect.sourceUid === uid && effect.code === 141)).toMatchObject({
    event: "continuous",
    range: ["monsterZone"],
    property: 0x20000,
    registryKey: "lua:48675364:lua-2-141",
  });
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

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function environmentProbeScript(generalCode: string, fieldCode: string): string {
  return `
    local general=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${generalCode}),0,LOCATION_MZONE,0,nil)
    Debug.Message("archfiend environment active " .. tostring(Duel.IsEnvironment(${fieldCode})))
    Debug.Message("archfiend self destroy effect " .. tostring(general:GetCardEffect(EFFECT_SELF_DESTROY)~=nil))
  `;
}

function dummySpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("archfiend general dummy resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("archfiend general responder resolved") end)
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
