import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const electroCode = "9107531";
const fireStarterCode = "91075310";
const deckPyroCode = "91075311";
const spellCode = "91075312";
const responderCode = "91075313";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasElectroScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${electroCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const racePyro = 0x80;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeDark = 0x20;
const categorySpecialSummon = 0x200;
const categoryToGrave = 0x20;
const categoryAttackChange = 0x200000;
const locationHand = 0x2;
const locationDeck = 0x1;
const effectUpdateAttack = 100;
const selectYes = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasElectroScript)("Lua real script Electro Blaster FIRE summon send Spell chain stat", () => {
  it("restores FIRE summon hand trigger with optional Deck send and Spell chaining ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${electroCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOGRAVE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_FIRE) and c:IsSummonPlayer(tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.GetMatchingGroup(s.tgfilter,tp,LOCATION_DECK,0,nil)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.SendtoGrave(sg,REASON_EFFECT)");
    expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
    expect(script).toContain("return re:IsSpellEffect() and re:IsHasType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,#g,tp,300)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(300)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 9107531, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [electroCode, fireStarterCode, deckPyroCode, spellCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const electro = requireCard(session, electroCode);
    const fireStarter = requireCard(session, fireStarterCode);
    const deckPyro = requireCard(session, deckPyroCode);
    const spell = requireCard(session, spellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, electro.uid, "hand", 0);
    moveDuelCard(session.state, fireStarter.uid, "hand", 0);
    moveDuelCard(session.state, spell.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = sourceWithLocalScripts(workspace);
    const host = createLuaScriptHost(session, workspace);
    for (const code of [electroCode, spellCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === fireStarter.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, normalSummon!);
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === electro.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: electro.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: fireStarter.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === electro.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1100",
        sourceUid: electro.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: fireStarter.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: categorySpecialSummon, targetUids: [electro.uid], count: 1, player: 0, parameter: locationHand }],
        possibleOperationInfos: [{ category: categoryToGrave, targetUids: [], count: 1, player: 0, parameter: locationDeck }],
      },
    ]);

    const restoredHandTriggerChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader, { promptOverrides: selectYes });
    expectCleanRestore(restoredHandTriggerChain);
    expectRestoredLegalActions(restoredHandTriggerChain, 1);
    expect(getLuaRestoreLegalActions(restoredHandTriggerChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredHandTriggerChain);

    expect(restoredHandTriggerChain.session.state.cards.find((card) => card.uid === electro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: electro.uid,
      reasonEffectId: 1,
    });
    expect(restoredHandTriggerChain.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 145720498, returned: true },
    ]);
    expect(restoredHandTriggerChain.session.state.cards.find((card) => card.uid === deckPyro.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: electro.uid,
      reasonEffectId: 1,
    });
    expect(restoredHandTriggerChain.host.messages).not.toContain("electro blaster responder resolved");
    expect(restoredHandTriggerChain.session.state.eventHistory.filter((event) => ["specialSummoned", "breakEffect", "sentToGraveyard"].includes(event.eventName))).toEqual([
      specialSummonedEvent(electro.uid, electro.uid, 1, { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 }, { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 }),
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: electro.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: deckPyro.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: electro.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredSpellOpen = restoreDuelWithLuaScripts(serializeDuel(restoredHandTriggerChain.session), source, reader);
    expectCleanRestore(restoredSpellOpen);
    expectRestoredLegalActions(restoredSpellOpen, 0);
    const spellActivation = getLuaRestoreLegalActions(restoredSpellOpen, 0).find((action) => action.type === "activateEffect" && action.uid === spell.uid);
    expect(spellActivation, JSON.stringify(getLuaRestoreLegalActions(restoredSpellOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSpellOpen, spellActivation!);
    expect(restoredSpellOpen.session.state.pendingTriggers.filter((pending) => pending.sourceUid === electro.uid)).toEqual([
      {
        id: "trigger-8-1",
        effectId: "lua-3-1027",
        sourceUid: electro.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "chaining",
        eventCode: 1027,
        eventCardUid: spell.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-8",
        eventTriggerTiming: "if",
        relatedEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredAtkTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSpellOpen.session), source, reader);
    expectCleanRestore(restoredAtkTrigger);
    expectRestoredLegalActions(restoredAtkTrigger, 0);
    const atkTrigger = getLuaRestoreLegalActions(restoredAtkTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === electro.uid);
    expect(atkTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAtkTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAtkTrigger, atkTrigger!);
    expect(restoredAtkTrigger.session.state.chain).toEqual([
      {
        id: "chain-8",
        chainIndex: 1,
        effectId: "lua-4-1002",
        sourceUid: spell.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 2,
      },
      {
        id: "chain-9",
        chainIndex: 2,
        effectId: "lua-3-1027",
        sourceUid: electro.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 1,
        eventName: "chaining",
        eventCode: 1027,
        eventCardUid: spell.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-8",
        eventTriggerTiming: "if",
        relatedEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        operationInfos: [{ category: categoryAttackChange, targetUids: [fireStarter.uid, electro.uid], count: 2, player: 0, parameter: 300 }],
      },
    ]);
    const restoredAtkChain = restoreDuelWithLuaScripts(serializeDuel(restoredAtkTrigger.session), source, reader);
    expectCleanRestore(restoredAtkChain);
    expectRestoredLegalActions(restoredAtkChain, 0);
    expect(getLuaRestoreLegalActions(restoredAtkChain, 0)).toEqual([
      {
        type: "declineTrigger",
        player: 0,
        triggerId: "trigger-9-1",
        triggerBucket: "turnOptional",
        uid: electro.uid,
        effectId: "lua-3-1027",
        label: "Decline Electro Blaster: lua-3-1027",
        windowId: 5,
        windowKind: "triggerBucket",
        windowToken: "window-c",
      },
    ]);
    applyRestoredActionAndAssert(restoredAtkChain, getLuaRestoreLegalActions(restoredAtkChain, 0)[0]!);
    resolveRestoredChain(restoredAtkChain);
    expect(currentAttack(restoredAtkChain.session.state.cards.find((card) => card.uid === fireStarter.uid), restoredAtkChain.session.state)).toBe(1300);
    expect(currentAttack(restoredAtkChain.session.state.cards.find((card) => card.uid === electro.uid), restoredAtkChain.session.state)).toBe(2100);
    expect(restoredAtkChain.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: fireStarter.uid, value: 300 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: electro.uid, value: 300 },
    ]);
    expect(restoredAtkChain.host.messages).not.toContain("electro blaster responder resolved");
    expect(restoredAtkChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === electroCode),
    { code: fireStarterCode, name: "Electro Blaster FIRE Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: deckPyroCode, name: "Electro Blaster Level 8 Pyro", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 8, attack: 2400, defense: 2000 },
    { code: spellCode, name: "Electro Blaster Spell Trigger", kind: "spell", typeFlags: typeSpell },
    { code: responderCode, name: "Electro Blaster Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function sourceWithLocalScripts(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${spellCode}.lua`) return spellScript();
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
}

function spellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
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
      e:SetOperation(function(e,tp) Debug.Message("electro blaster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function specialSummonedEvent(cardUid: string, sourceUid: string, sourceEffectId: number, eventPreviousState: object, eventCurrentState: object) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventUids: [cardUid],
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: sourceEffectId,
    eventPreviousState,
    eventCurrentState,
  };
}
