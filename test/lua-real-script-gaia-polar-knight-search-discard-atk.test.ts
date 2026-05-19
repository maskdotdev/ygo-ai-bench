import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const gaiaCode = "14882493";
const hasGaiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gaiaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasGaiaScript)("Lua real script Gaia, the Polar Knight search discard and ATK boost", () => {
  it("restores its DARK release-cost LIGHT Warrior search and follow-up hand discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkReleaseCode = "14882494";
    const lightSearchCode = "14882495";
    const responderCode = "14882496";
    const script = workspace.readScript(`c${gaiaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_HANDES)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsAttribute,1,false,nil,e:GetHandler(),ATTRIBUTE_DARK)");
    expect(script).toContain("return c:GetLevel()==4 and c:IsRace(RACE_WARRIOR) and c:IsAttribute(ATTRIBUTE_LIGHT) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,1,tp,1)");
    expect(script).toContain("Duel.DiscardHand(tp,nil,1,1,REASON_EFFECT)");

    const cards = createGaiaCards([
      { code: darkReleaseCode, name: "Gaia DARK Release", attribute: attributeDark },
      { code: lightSearchCode, name: "Gaia LIGHT Search", attribute: attributeLight },
      { code: responderCode, name: "Gaia Chain Responder", attribute: attributeDark },
    ]);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 14882493, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gaiaCode, darkReleaseCode, lightSearchCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const gaia = requireCard(session, gaiaCode);
    const darkRelease = requireCard(session, darkReleaseCode);
    const lightSearch = requireCard(session, lightSearchCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, gaia.uid, "monsterZone", 0).position = "faceUpAttack";
    gaia.faceUp = true;
    moveDuelCard(session.state, darkRelease.uid, "monsterZone", 0).position = "faceUpAttack";
    darkRelease.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = createSourceWithResponder(workspace, responderCode, "gaia search responder resolved");
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gaiaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const searchAction = findEffectAction(restoredOpen.session, getLuaRestoreLegalActions(restoredOpen, 0), gaia.uid, stringId(0));
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, searchAction!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 },
      { category: 0x80, targetUids: [], count: 1, player: 0, parameter: 1 },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === darkRelease.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lightSearch.uid)).toMatchObject({ location: "deck" });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("gaia search responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === lightSearch.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "sentToHand", "confirmed", "sentToHandConfirmed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: darkRelease.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: gaia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: darkRelease.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: gaia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: lightSearch.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gaia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: lightSearch.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [lightSearch.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gaia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: lightSearch.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [lightSearch.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gaia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: lightSearch.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gaia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 1,
        },
      },
    ]);
  });

  it("restores its LIGHT aux.SpElimFilter banish cost into a targeted two-turn ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lightCostCode = "14882497";
    const responderCode = "14882498";
    const script = workspace.readScript(`c${gaiaCode}.lua`);
    expect(script).toContain("aux.SpElimFilter(c,true)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil,tp)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(500)");

    const cards = createGaiaCards([
      { code: lightCostCode, name: "Gaia LIGHT Banish Cost", attribute: attributeLight },
      { code: responderCode, name: "Gaia ATK Chain Responder", attribute: attributeDark },
    ]);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 14882497, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gaiaCode, lightCostCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const gaia = requireCard(session, gaiaCode);
    const lightCost = requireCard(session, lightCostCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, gaia.uid, "monsterZone", 0).position = "faceUpAttack";
    gaia.faceUp = true;
    moveDuelCard(session.state, lightCost.uid, "graveyard", 0);
    lightCost.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = createSourceWithResponder(workspace, responderCode, "gaia atk responder resolved");
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gaiaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const atkAction = findEffectAction(restoredOpen.session, getLuaRestoreLegalActions(restoredOpen, 0), gaia.uid, stringId(1));
    expect(atkAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, atkAction!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lightCost.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
      reason: duelReason.cost,
    });
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]?.targetUids).toEqual([gaia.uid]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("gaia atk responder resolved");
    const boostedGaia = restoredChain.session.state.cards.find((card) => card.uid === gaia.uid);
    expect(currentAttack(boostedGaia, restoredChain.session.state)).toBe((gaia.data.attack ?? 0) + 500);
    expect(restoredChain.session.state.effects.find((effect) => effect.sourceUid === gaia.uid && effect.code === 100)).toMatchObject({
      code: 100,
      event: "continuous",
      sourceUid: gaia.uid,
      value: 500,
      reset: { flags: 0x41fe1200, count: 2 },
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["banished", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: lightCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: gaia.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 2,
      },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === gaia.uid), restoredBoost.session.state)).toBe((gaia.data.attack ?? 0) + 500);
  });
});

function createGaiaCards(extra: Array<{ code: string; name: string; attribute: number }>): DuelCardData[] {
  return [
    { code: gaiaCode, name: "Gaia, the Polar Knight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    ...extra.map((card) => ({
      code: card.code,
      name: card.name,
      kind: "monster" as const,
      typeFlags: typeMonster | typeEffect,
      race: raceWarrior,
      attribute: card.attribute,
      level: 4,
      attack: 1000,
      defense: 1000,
    })),
  ];
}

function createSourceWithResponder(workspace: ReturnType<typeof createUpstreamNodeWorkspace>, responderCode: string, message: string) {
  return {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript(message);
      return workspace.readScript(name);
    },
  };
}

function chainResponderScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function stringId(index: number): number {
  return Number(gaiaCode) * 16 + index;
}

function findEffectAction(session: DuelSession, actions: DuelAction[], uid: string, description: number): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    return session.state.effects.find((effect) => effect.id === action.effectId && effect.sourceUid === uid)?.description === description;
  });
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
