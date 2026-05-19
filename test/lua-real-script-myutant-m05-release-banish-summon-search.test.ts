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
const m05Code = "62201847";
const mistCode = "61089209";
const decoyCode = "622018471";
const costSpellCode = "622018472";
const responderCode = "622018473";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const racePsychic = 0x400;
const attributeWater = 0x2;
const setMyutant = 0x159;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Myutant M-05 release banish summon search", () => {
  it("restores delayed summon search plus release and banish cost into label-driven boss summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${m05Code}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.GetMZoneCount(tp,c)");
    expect(script).toContain("Duel.Release(c,REASON_COST)");
    expect(script).toContain("Duel.Remove(rg,POS_FACEUP,REASON_COST)");
    expect(script).toContain("e:SetLabel(s.getspcode(rg:GetFirst()))");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === m05Code || card.code === mistCode),
      { code: decoyCode, name: "Myutant M-05 Decoy Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setMyutant] },
      { code: costSpellCode, name: "Myutant M-05 Cost Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setMyutant] },
      { code: responderCode, name: "Myutant M-05 Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeWater, level: 3, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 62201847, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [m05Code, mistCode, decoyCode, costSpellCode, mistCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const m05 = requireCard(session, m05Code);
    const mistCopies = session.state.cards.filter((card) => card.code === mistCode);
    expect(mistCopies).toHaveLength(2);
    const decoy = requireCard(session, decoyCode);
    const costSpell = requireCard(session, costSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, m05.uid, "hand", 0);
    moveDuelCard(session.state, costSpell.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(m05Code), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const normalSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === m05.uid);
    expect(normalSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, normalSummon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === m05.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: m05.uid,
        player: 0,
        effectId: "lua-1-1100",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: m05.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    resolveRestoredChain(restoredSearchChain);
    const searchedMist = restoredSearchChain.session.state.cards.find((card) => card.code === mistCode && card.location === "hand");
    const summonedMist = restoredSearchChain.session.state.cards.find((card) => card.code === mistCode && card.location === "deck");
    expect(searchedMist).toBeDefined();
    expect(summonedMist).toBeDefined();
    expect(searchedMist).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: m05.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: m05.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchedMist!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: m05.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: searchedMist!.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [searchedMist!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: m05.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: searchedMist!.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [searchedMist!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: m05.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
    ]);

    const restoredIgnitionWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSearchChain.session), source, reader);
    expectCleanRestore(restoredIgnitionWindow);
    expectRestoredLegalActions(restoredIgnitionWindow, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnitionWindow, 0).find((action) => action.type === "activateEffect" && action.uid === m05.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnitionWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnitionWindow, ignition!);
    expect(restoredIgnitionWindow.session.state.cards.find((card) => card.uid === m05.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: m05.uid,
      reasonEffectId: 3,
    });
    expect(restoredIgnitionWindow.session.state.cards.find((card) => card.uid === costSpell.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: m05.uid,
      reasonEffectId: 3,
    });
    expect(restoredIgnitionWindow.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        sourceUid: m05.uid,
        player: 0,
        effectId: "lua-3",
        effectLabel: Number(mistCode),
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnitionWindow.session), source, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, 1);
    resolveRestoredChain(restoredSummonChain);
    const specialSummonedMist = restoredSummonChain.session.state.cards.find((card) => card.code === mistCode && card.location === "monsterZone");
    expect(specialSummonedMist).toBeDefined();
    expect(specialSummonedMist).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: m05.uid,
      reasonEffectId: 3,
    });
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "banished", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: m05.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: m05.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: m05.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: m05.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: costSpell.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: m05.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: specialSummonedMist!.uid,
        eventUids: [specialSummonedMist!.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: m05.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
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
      e:SetOperation(function(e,tp) Debug.Message("myutant m05 responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
