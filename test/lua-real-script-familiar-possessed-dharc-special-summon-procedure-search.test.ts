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
const dharcCode = "21390858";
const charmerCode = "19327348";
const darkMaterialCode = "213908580";
const lightSearchCode = "213908581";
const responderCode = "213908582";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Familiar-Possessed - Dharc procedure search", () => {
  it("restores its Deck summon procedure materials, pierce grant, and summon-success LIGHT Spellcaster search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dharcCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_DECK)");
    expect(script).toContain("aux.ChkfMMZ(1)(sg,e,tp,mg)");
    expect(script).toContain("aux.SelectUnselectGroup(g1,e,tp,2,2,s.rescon,1,tp,HINTMSG_TOGRAVE)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("Duel.ShuffleDeck(tp)");
    expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return (lv==3 or lv==4) and c:IsAttribute(ATTRIBUTE_LIGHT) and c:IsRace(RACE_SPELLCASTER) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dharcCode),
      monster(charmerCode, "Dharc the Dark Charmer Material", attributeDark),
      monster(darkMaterialCode, "Familiar-Possessed Dharc DARK Material", attributeDark),
      monster(lightSearchCode, "Familiar-Possessed Dharc LIGHT Search", attributeLight),
      monster(responderCode, "Familiar-Possessed Dharc Chain Responder", attributeDark),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21390858, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dharcCode, charmerCode, darkMaterialCode, lightSearchCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const dharc = requireCard(session, dharcCode);
    const charmer = requireCard(session, charmerCode);
    const darkMaterial = requireCard(session, darkMaterialCode);
    const lightSearch = requireCard(session, lightSearchCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, charmer.uid, "monsterZone", 0);
    charmer.faceUp = true;
    charmer.position = "faceUpAttack";
    moveDuelCard(session.state, darkMaterial.uid, "monsterZone", 0);
    darkMaterial.faceUp = true;
    darkMaterial.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const text = workspace.readScript(name);
        if (text === undefined) throw new Error(`Missing script ${name}`);
        return text;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dharcCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredProcedure = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === dharc.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === dharc.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === charmer.uid)).toMatchObject({ location: "graveyard", reason: duelReason.cost });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === darkMaterial.uid)).toMatchObject({ location: "graveyard", reason: duelReason.cost });
    expect(restoredProcedure.session.state.effects.find((effect) => effect.sourceUid === dharc.uid && effect.code === 203)).toMatchObject({
      event: "continuous",
      code: 203,
      sourceUid: dharc.uid,
      reset: { flags: 16715776 },
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-2-1102",
        sourceUid: dharc.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: dharc.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === dharc.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-2-1102",
        sourceUid: dharc.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: dharc.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("dharc responder resolved");
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${lightSearchCode}`);
    expect(restoredChain.session.state.cards.find((card) => card.uid === lightSearch.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dharc.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToGraveyardEvent(charmer.uid, dharc.uid, 0),
      sentToGraveyardEvent(darkMaterial.uid, dharc.uid, 1),
      sentToGraveyardGroupEvent(charmer.uid, darkMaterial.uid, dharc.uid),
      specialSummonedEvent(dharc.uid),
      sentToHandEvent(lightSearch.uid, dharc.uid),
      confirmedEvent(lightSearch.uid, dharc.uid),
      sentToHandConfirmedEvent(lightSearch.uid, dharc.uid),
    ]);
  });
});

function monster(code: string, name: string, attribute: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute, level: 4, attack: 1000, defense: 1500 };
}

function sentToGraveyardEvent(cardUid: string, sourceUid: string, sequence: number) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence },
  };
}

function sentToGraveyardGroupEvent(firstUid: string, secondUid: string, sourceUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: firstUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventUids: [firstUid, secondUid],
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function specialSummonedEvent(cardUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
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
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
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
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
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
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
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
      e:SetOperation(function(e,tp) Debug.Message("dharc responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
