import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const alphaCode = "97148796";
const tributeCode = "971487960";
const searchCode = "971487961";
const decoyCode = "971487962";
const responderCode = "971487963";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceMachine = 0x20;
const raceSpellcaster = 0x10;
const attributeLight = 0x10;
const setDrytron = 0x151;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Drytron Alpha tribute summon search", () => {
  it("restores replaceable tribute cost, defense Special Summon, optional search, and oath lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${alphaCode}.lua`);
    const commonScript = workspace.readScript("cards_specific_functions.lua");
    expect(script).toContain("c:EnableUnsummonable()");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e2:SetCost(Drytron.TributeCost)");
    expect(script).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_SPSUMMON,s.sumfilter)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,c:GetLocation())");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
    expect(commonScript).toContain("Drytron.TributeCost=Cost.AND(Cost.Replaceable(tribute_base_cost,extracon),tribute_extra_cost)");
    expect(commonScript).toContain("Duel.Release(sg,REASON_COST)");
    expect(commonScript).toContain("e1:SetTarget(function(e,c) return c:IsSummonableCard() end)");

    const cards: DuelCardData[] = [
      { code: alphaCode, name: "Drytron Alpha Thuban", kind: "monster", typeFlags: 0x2000001, race: raceMachine, attribute: attributeLight, level: 1, attack: 2000, defense: 0, setcodes: [setDrytron] },
      { code: tributeCode, name: "Drytron Alpha Ritual Tribute", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 1800, defense: 2400 },
      { code: searchCode, name: "Drytron Alpha Ritual Monster Search", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 2000, defense: 2000 },
      { code: decoyCode, name: "Drytron Alpha Non-Ritual Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 1, attack: 500, defense: 500 },
      { code: responderCode, name: "Drytron Alpha Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 1, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 97148796, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alphaCode, tributeCode, searchCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const alpha = requireCard(session, alphaCode);
    const tribute = requireCard(session, tributeCode);
    const search = requireCard(session, searchCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, alpha.uid, "hand", 0);
    const movedTribute = moveDuelCard(session.state, tribute.uid, "monsterZone", 0);
    movedTribute.sequence = 0;
    movedTribute.faceUp = true;
    movedTribute.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(alphaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const special = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === alpha.uid);
    expect(special, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, special!);
    expect(session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: alpha.uid,
      reasonEffectId: 5,
    });
    expect(session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: alpha.uid,
        player: 0,
        effectId: "lua-5",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, targetUids: [alpha.uid], count: 1, player: 0, parameter: 0x2 }],
        possibleOperationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === alpha.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
    ]));
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredChain.host.messages).not.toContain("drytron alpha responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === alpha.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: alpha.uid,
      reasonEffectId: 5,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: alpha.uid,
      reasonEffectId: 5,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.effects.some((effect) => effect.sourceUid === alpha.uid && effect.luaTargetDescriptor === "special-summon-limit:summonable-card")).toBe(true);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "specialSummoned", "breakEffect", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: tribute.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: alpha.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: tribute.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: alpha.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: alpha.uid,
        eventUids: [alpha.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: alpha.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: alpha.uid,
        eventReasonEffectId: 5,
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: search.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: alpha.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: alpha.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: alpha.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
      e:SetOperation(function(e,tp) Debug.Message("drytron alpha responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
