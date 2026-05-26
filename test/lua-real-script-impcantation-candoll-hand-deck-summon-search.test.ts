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
const candollCode = "53303460";
const talismandraCode = "80701178";
const ritualSpellCode = "533034600";
const ritualMonsterCode = "533034601";
const decoyCode = "533034602";
const responderCode = "533034603";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceSpellcaster = 0x10;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Impcantation Candoll hand deck summon search", () => {
  it("restores Ritual reveal cost, hand plus Deck Special Summon, delayed trigger, and Ritual Monster search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const candollScript = workspace.readScript(`c${candollCode}.lua`);
    const talismandraScript = workspace.readScript(`c${talismandraCode}.lua`);
    expect(candollScript).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(candollScript).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(candollScript).toContain("Duel.ShuffleHand(tp)");
    expect(candollScript).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,2,tp,LOCATION_HAND|LOCATION_DECK)");
    expect(candollScript).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(candollScript).toContain("aux.addContinuousLizardCheck(c,LOCATION_MZONE)");
    expect(talismandraScript).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_DECK)");
    expect(talismandraScript).toContain("return c:IsRitualMonster() and c:IsAbleToHand()");
    expect(talismandraScript).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(talismandraScript).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === candollCode || card.code === talismandraCode),
      { code: ritualSpellCode, name: "Impcantation Candoll Ritual Spell Cost", kind: "spell", typeFlags: typeSpell | typeRitual },
      {
        code: ritualMonsterCode,
        name: "Impcantation Talismandra Ritual Monster Search",
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typeRitual,
        race: raceSpellcaster,
        attribute: attributeLight,
        level: 6,
        attack: 1800,
        defense: 2400,
      },
      { code: decoyCode, name: "Impcantation Non-Ritual Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Impcantation Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 53303460, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [candollCode, ritualSpellCode, talismandraCode, ritualMonsterCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const candoll = requireCard(session, candollCode);
    const talismandra = requireCard(session, talismandraCode);
    const ritualSpell = requireCard(session, ritualSpellCode);
    const ritualMonster = requireCard(session, ritualMonsterCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, candoll.uid, "hand", 0);
    moveDuelCard(session.state, ritualSpell.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(candollCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(talismandraCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const special = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === candoll.uid);
    expect(special, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, special!);
    expect(session.state.eventHistory.filter((event) => event.eventName === "confirmed" && event.eventCardUid === ritualSpell.uid)).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: ritualSpell.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [ritualSpell.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: candoll.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, targetUids: [], count: 2, player: 0, parameter: 0x3 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("impcantation responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === candoll.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: candoll.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === talismandra.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: candoll.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ritualSpell.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ritualMonster.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.pendingTriggers).toHaveLength(1);
    const pendingTalismandraSearch = restoredChain.session.state.pendingTriggers[0]!;
    expect(pendingTalismandraSearch).toEqual({
      id: pendingTalismandraSearch.id,
      effectId: pendingTalismandraSearch.effectId,
      sourceUid: talismandra.uid,
      player: 0,
      triggerBucket: "turnOptional",
      eventName: "specialSummoned",
      eventCode: 1102,
      eventPlayer: 0,
      eventCardUid: talismandra.uid,
      eventUids: [talismandra.uid, candoll.uid],
      eventReason: duelReason.summon | duelReason.specialSummon,
      eventReasonPlayer: 0,
      eventReasonCardUid: candoll.uid,
      eventReasonEffectId: 1,
      eventTriggerTiming: "if",
      eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
      eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === candoll.uid || effect.sourceUid === talismandra.uid).map((effect) => effect.luaTargetDescriptor)).toContain(
      "special-summon-limit:extra",
    );
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({ eventCardUid: event.eventCardUid, eventUids: event.eventUids }))).toEqual([
      { eventCardUid: talismandra.uid, eventUids: [talismandra.uid, candoll.uid] },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === talismandra.uid);
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, searchTrigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        sourceUid: talismandra.uid,
        player: 0,
        effectId: "lua-6-1102",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: talismandra.uid,
        eventUids: [talismandra.uid, candoll.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: candoll.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }],
      },
    ]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    resolveRestoredChain(restoredSearchChain);
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === ritualMonster.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: talismandra.uid,
      reasonEffectId: 6,
    });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.host.messages).toContain(`confirmed 1: ${ritualMonsterCode}`);
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName) && event.eventCardUid === ritualMonster.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: ritualMonster.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: talismandra.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: ritualMonster.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [ritualMonster.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: talismandra.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: ritualMonster.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [ritualMonster.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: talismandra.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
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
      e:SetOperation(function(e,tp) Debug.Message("impcantation responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
