import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const attributeWind = 0x8;
const attributeLight = 0x10;
const setRadiantTyphoon = 0x1c9;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Radiant Typhoon Mandate Graveyard draw stat", () => {
  it("restores Radiant Typhoon Mandate's Quick-Play Graveyard targets, Deck shuffle, draw, and WIND stat field effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mandateCode = "53813120";
    const radiantGraveCode = "53813121";
    const graveBCode = "53813122";
    const graveCCode = "53813123";
    const drawCode = "53813124";
    const windMonsterCode = "53813125";
    const lightMonsterCode = "53813126";
    const responderCode = "53813127";
    const script = workspace.readScript(`c${mandateCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_DRAW+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetRange(LOCATION_SZONE)");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.tdfilter,tp,LOCATION_GRAVE,0,nil,e)");
    expect(script).toContain("local tg=aux.SelectUnselectGroup(g,e,tp,3,3,s.rescon,1,tp,HINTMSG_TODECK)");
    expect(script).toContain("Duel.SetTargetCard(tg)");
    expect(script).toContain("Duel.GetTargetCards(e)");
    expect(script).toContain("Duel.SendtoDeck(tg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
    expect(script).toContain("Duel.ShuffleDeck(tp)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
    expect(script).toContain("aux.RegisterClientHint");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mandateCode),
      { code: radiantGraveCode, name: "Radiant Typhoon Graveyard Quick-Play", kind: "spell", typeFlags: typeSpell | typeQuickPlay, setcodes: [setRadiantTyphoon] },
      { code: graveBCode, name: "Radiant Typhoon Generic Quick-Play B", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
      { code: graveCCode, name: "Radiant Typhoon Generic Quick-Play C", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
      { code: drawCode, name: "Radiant Typhoon Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: windMonsterCode, name: "Radiant Typhoon WIND Stat Probe", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, level: 4, attack: 1500, defense: 1400 },
      { code: lightMonsterCode, name: "Radiant Typhoon LIGHT Stat Probe", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, level: 4, attack: 1600, defense: 1300 },
      { code: responderCode, name: "Radiant Typhoon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 53813120, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mandateCode, radiantGraveCode, graveBCode, graveCCode, drawCode, windMonsterCode, lightMonsterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const mandate = requireCard(session, mandateCode);
    const graveCards = [requireCard(session, radiantGraveCode), requireCard(session, graveBCode), requireCard(session, graveCCode)];
    const drawCard = requireCard(session, drawCode);
    const windMonster = requireCard(session, windMonsterCode);
    const lightMonster = requireCard(session, lightMonsterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, mandate.uid, "spellTrapZone", 0).faceUp = true;
    for (const card of graveCards) moveDuelCard(session.state, card.uid, "graveyard", 0);
    moveDuelCard(session.state, windMonster.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, lightMonster.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mandateCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mandate.uid);
    expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: mandate.uid,
        player: 0,
        effectId: "lua-2-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetUids: graveCards.map((card) => card.uid),
        operationInfos: [
          { category: 0x10, targetUids: graveCards.map((card) => card.uid), count: 3, player: 0, parameter: 0 },
          { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
        ],
        possibleOperationInfos: [
          { category: 0x200000, targetUids: [], count: 0, player: 0, parameter: 300 },
          { category: 0x400000, targetUids: [], count: 0, player: 0, parameter: 300 },
        ],
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toEqual(session.state.chain);
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === mandate.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[0]!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[1]!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[2]!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === windMonster.uid), restored.session.state)).toBe(1800);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === windMonster.uid), restored.session.state)).toBe(1700);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === lightMonster.uid), restored.session.state)).toBe(1600);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === lightMonster.uid), restored.session.state)).toBe(1300);
    expect(restored.host.messages).not.toContain("radiant typhoon responder resolved");
    expect(restored.session.state.eventHistory.filter((event) => ["sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mandate.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[1]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 2 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mandate.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[2]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 3 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mandate.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventUids: graveCards.map((card) => card.uid),
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 2 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mandate.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [graveCards[0]!.uid],
        eventCardUid: graveCards[0]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mandate.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
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
      e:SetOperation(function(e,tp) Debug.Message("radiant typhoon responder resolved") end)
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
