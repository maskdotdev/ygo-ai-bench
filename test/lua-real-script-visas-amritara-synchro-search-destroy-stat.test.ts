import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardCodes } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttack, currentFiniteEffectValues } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const amritaraCode = "821049";
const visasCode = "56099748";
const searchCode = "8210490";
const lightTunerCode = "8210491";
const lightNonTunerCode = "8210492";
const destroyTargetCode = "8210493";
const synchroAllyCode = "8210494";
const responderCode = "8210495";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAmritaraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${amritaraCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasAmritaraScript)("Lua real script Visas Amritara Synchro search destroy stat", () => {
  it("restores LIGHT Synchro procedure into search trigger, Visas code, and destroy-for-Synchro ATK field buff", () => {
    const { workspace, source } = sourceWithResponder();
    const script = workspace.readScript(`official/c${amritaraCode}.lua`);
    expect(script).toContain("Synchro.AddProcedure(c,nil,1,99,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT),1,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e1:SetValue(CARD_VISAS_STARFROST)");
    expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCondition(function(e) return e:GetHandler():IsSynchroSummoned() end)");
    expect(script).toContain("return c:ListsCode(CARD_VISAS_STARFROST) and c:IsSpellTrap() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_MZONE,0)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsType,TYPE_SYNCHRO))");
    expect(script).toContain("e1:SetValue(800)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    expect(script).toContain("e4:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("e1:SetCode(EFFECT_MULTIPLE_TUNERS)");

    const reader = createCardReader(amritaraCards());
    const summonSession = createDuel({ seed: 821049, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [lightTunerCode, lightNonTunerCode, searchCode], extra: [amritaraCode] }, 1: { main: [responderCode] } });
    startDuel(summonSession);

    const summonedAmritara = requireCard(summonSession, amritaraCode);
    const tuner = requireCard(summonSession, lightTunerCode);
    const nonTuner = requireCard(summonSession, lightNonTunerCode);
    const search = requireCard(summonSession, searchCode);
    const responder = requireCard(summonSession, responderCode, 1);
    moveFaceUpAttack(summonSession, tuner, 0);
    moveFaceUpAttack(summonSession, nonTuner, 0);
    moveDuelCard(summonSession.state, responder.uid, "hand", 1);
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;

    const summonHost = createLuaScriptHost(summonSession, workspace);
    for (const code of [amritaraCode, responderCode]) expect(summonHost.loadCardScript(Number(code), source).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(2);
    expect(summonedAmritara.data.synchroTunerMin).toBe(1);
    expect(summonedAmritara.data.synchroTunerMax).toBe(99);
    expect(summonedAmritara.data.synchroNonTunerMin).toBe(1);
    expect(summonedAmritara.data.synchroNonTunerMax).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(summonSession), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchro = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "synchroSummon" && action.uid === summonedAmritara.uid && action.materialUids.includes(tuner.uid) && action.materialUids.includes(nonTuner.uid),
    );
    expect(synchro, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, synchro!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === summonedAmritara.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
      reason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
    });
    const restoredAmritara = restoredOpen.session.state.cards.find((card) => card.uid === summonedAmritara.uid);
    expect(restoredAmritara).toBeDefined();
    expect(currentCardCodes(restoredAmritara!, restoredOpen.session.state)).toContain(visasCode);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonedAmritara.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        effectId: "lua-4-1102",
        sourceUid: summonedAmritara.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: summonedAmritara.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    expect(getLuaRestoreLegalActions(restoredSearchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredSearchChain);
    expect(restoredSearchChain.host.messages).not.toContain("amritara responder resolved");
    expect(restoredSearchChain.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonedAmritara.uid,
      reasonEffectId: 4,
    });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonedAmritara.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(search.uid, summonedAmritara.uid, 4, 0),
      confirmedEvent(search.uid, summonedAmritara.uid, 4, 0),
      sentToHandConfirmedEvent(search.uid, summonedAmritara.uid, 4, 0),
    ]);

    const ignitionSession = createDuel({ seed: 821050, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(ignitionSession, { 0: { main: [destroyTargetCode], extra: [amritaraCode, synchroAllyCode] }, 1: { main: [responderCode] } });
    startDuel(ignitionSession);
    const fieldAmritara = requireCard(ignitionSession, amritaraCode);
    const destroyTarget = requireCard(ignitionSession, destroyTargetCode);
    const synchroAlly = requireCard(ignitionSession, synchroAllyCode);
    const ignitionResponder = requireCard(ignitionSession, responderCode, 1);
    moveFaceUpAttack(ignitionSession, destroyTarget, 0);
    moveFaceUpAttack(ignitionSession, fieldAmritara, 0);
    moveFaceUpAttack(ignitionSession, synchroAlly, 0);
    moveDuelCard(ignitionSession.state, ignitionResponder.uid, "hand", 1);
    ignitionSession.state.phase = "main1";
    ignitionSession.state.turnPlayer = 0;
    ignitionSession.state.waitingFor = 0;

    const ignitionHost = createLuaScriptHost(ignitionSession, workspace);
    for (const code of [amritaraCode, responderCode]) expect(ignitionHost.loadCardScript(Number(code), source).ok).toBe(true);
    expect(ignitionHost.registerInitialEffects()).toBe(2);
    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(ignitionSession), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const destroy = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === fieldAmritara.uid && action.effectId === "lua-5");
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, destroy!);
    expect(restoredIgnition.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-5",
        sourceUid: fieldAmritara.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 1,
        operationInfos: [{ category: 0x1, targetUids: [destroyTarget.uid, fieldAmritara.uid, synchroAlly.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredDestroyChain);
    expectRestoredLegalActions(restoredDestroyChain, 1);
    expect(getLuaRestoreLegalActions(restoredDestroyChain, 1).some((action) => action.type === "activateEffect" && action.uid === ignitionResponder.uid)).toBe(true);
    resolveRestoredChain(restoredDestroyChain);
    expect(restoredDestroyChain.host.messages).not.toContain("amritara responder resolved");
    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fieldAmritara.uid,
      reasonEffectId: 5,
    });
    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === fieldAmritara.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(cardTypeFlags(restoredDestroyChain.session.state.cards.find((card) => card.uid === fieldAmritara.uid), restoredDestroyChain.session.state) & typeSynchro).toBe(typeSynchro);
    expect(currentFiniteEffectValues(restoredDestroyChain.session.state.cards.find((card) => card.uid === fieldAmritara.uid), restoredDestroyChain.session.state, 100)).toEqual([800]);
    expect(restoredDestroyChain.session.state.effects.filter((effect) => effect.sourceUid === fieldAmritara.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toContainEqual({
      code: 100,
      event: "continuous",
      luaTargetDescriptor: "target:type:8192",
      reset: { flags: 1073742336 },
      targetRange: [4, 0],
      value: 800,
    });
    expect(currentAttack(restoredDestroyChain.session.state.cards.find((card) => card.uid === fieldAmritara.uid), restoredDestroyChain.session.state)).toBe(3300);
    expect(currentAttack(restoredDestroyChain.session.state.cards.find((card) => card.uid === synchroAlly.uid), restoredDestroyChain.session.state)).toBe(2800);
    expect(restoredDestroyChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredDestroyChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      destroyedEvent(destroyTarget.uid, fieldAmritara.uid, 5, { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }, { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 }),
    ]);
  });
});

function sourceWithResponder() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  return {
    workspace,
    source: {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    },
  };
}

function amritaraCards(): DuelCardData[] {
  return [
    { code: amritaraCode, name: "Visas Amritara", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeLight, level: 8, attack: 2500, defense: 2100 },
    { code: searchCode, name: "Amritara Visas Search Spell", kind: "spell", typeFlags: typeSpell, listedNames: [visasCode] },
    { code: lightTunerCode, name: "Amritara LIGHT Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceSpellcaster, attribute: attributeLight, level: 3, attack: 800, defense: 1000 },
    { code: lightNonTunerCode, name: "Amritara LIGHT Non-Tuner", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 5, attack: 1700, defense: 1600 },
    { code: destroyTargetCode, name: "Amritara Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 900, defense: 900 },
    { code: synchroAllyCode, name: "Amritara Synchro Ally", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeLight, level: 6, attack: 2000, defense: 1600 },
    { code: responderCode, name: "Amritara Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("amritara responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function sentToHandEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
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
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
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
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, effectId: number, previous: Record<string, unknown>, current: Record<string, unknown>) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: previous,
    eventCurrentState: current,
  };
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
