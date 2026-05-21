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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const clockDragonCode = "42717221";
const hasClockDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clockDragonCode}.lua`));
const clockWyvernCode = "21830679";
const linkMaterialCode = "427172210";
const deckMillOneCode = "427172211";
const deckMillTwoCode = "427172212";
const searchSpellCode = "427172213";
const responderCode = "427172214";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasClockDragonScript)("Lua real script Cyberse Clock Dragon fusion mill stat", () => {
  it("restores Fusion.AddProcMixRep Link material metadata, operated Deck mill, ATK gain, and attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${clockDragonCode}.lua`);
    expect(script).toContain("Fusion.AddProcMixRep(c,true,true,aux.FilterBoolFunctionEx(Card.IsType,TYPE_LINK),1,99,21830679)");
    expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE+CATEGORY_DECKDES)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
    expect(script).toContain("c:GetMaterial():Filter(Card.IsType,nil,TYPE_LINK):GetSum(Card.GetLink)");
    expect(script).toContain("Duel.IsPlayerCanDiscardDeck(tp,ct)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,ct)");
    expect(script).toContain("Duel.DiscardDeck(tp,ct,REASON_EFFECT)");
    expect(script).toContain("Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_GRAVE)*1000");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("Duel.RegisterEffect(e2,tp)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
    expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: clockDragonCode, name: "Cyberse Clock Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceCyberse, attribute: attributeDark, level: 7, attack: 2500, defense: 2000 },
      { code: clockWyvernCode, name: "Clock Wyvern", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeWind, level: 4, attack: 1800, defense: 1000 },
      { code: linkMaterialCode, name: "Cyberse Link-2 Material", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 1800, defense: 0, linkMarkers: 0x28 },
      { code: deckMillOneCode, name: "Clock Dragon Mill One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
      { code: deckMillTwoCode, name: "Clock Dragon Mill Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
      { code: searchSpellCode, name: "Clock Dragon Search Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Clock Dragon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 42717221, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [clockWyvernCode, deckMillOneCode, deckMillTwoCode, searchSpellCode], extra: [clockDragonCode, linkMaterialCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const clockDragon = requireCard(session, clockDragonCode);
    const clockWyvern = requireCard(session, clockWyvernCode);
    const linkMaterial = requireCard(session, linkMaterialCode);
    const deckMillOne = requireCard(session, deckMillOneCode);
    const deckMillTwo = requireCard(session, deckMillTwoCode);
    const searchSpell = requireCard(session, searchSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, clockWyvern.uid, "hand", 0);
    moveDuelCard(session.state, linkMaterial.uid, "monsterZone", 0);
    linkMaterial.faceUp = true;
    linkMaterial.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(clockDragonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(clockDragon.data.fusionMaterialMin).toBe(1);
    expect(clockDragon.data.fusionMaterialMax).toBe(99);
    expect(clockDragon.data.fusionMaterialType).toBe(typeLink);
    expect(clockDragon.data.fusionMaterials).toEqual([clockWyvernCode]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const fusionSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action): action is Extract<DuelAction, { type: "fusionSummon" }> =>
      action.type === "fusionSummon" && action.uid === clockDragon.uid && sameMembers(action.materialUids, [clockWyvern.uid, linkMaterial.uid]));
    expect(fusionSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, fusionSummon!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === clockDragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "fusion",
      summonMaterialUids: [clockWyvern.uid, linkMaterial.uid],
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-2-1102",
        sourceUid: clockDragon.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: clockDragon.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const targetProtection = restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === clockDragon.uid && effect.code === 71);
    expect(targetProtection).toMatchObject({ event: "continuous", range: ["monsterZone"], targetRange: [4, 0] });
    const battleTargetLock = restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === clockDragon.uid && effect.code === 332);
    expect(battleTargetLock).toMatchObject({ event: "continuous", range: ["monsterZone"], targetRange: [0, 4] });
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === clockDragon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        effectId: "lua-2-1102",
        sourceUid: clockDragon.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: clockDragon.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x40, targetUids: [], count: 0, player: 0, parameter: 2 },
          { category: 0x200000, targetUids: [clockDragon.uid], count: 1, player: 0, parameter: 2000 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("clock dragon responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === searchSpell.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: clockDragon.uid, reasonEffectId: 2 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === deckMillTwo.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: clockDragon.uid, reasonEffectId: 2 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === deckMillOne.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === clockDragon.uid), restoredChain.session.state)).toBe(4500);
    expect(restoredChain.session.state.effects.some((effect) => effect.sourceUid === clockDragon.uid && effect.code === 100 && effect.value === 2000)).toBe(true);
    expect(
      restoredChain.session.state.effects.some((effect) => effect.code === 85 && effect.label === restoredChain.session.state.cards.find((card) => card.uid === clockDragon.uid)?.fieldId),
      JSON.stringify(restoredChain.session.state.effects.filter((effect) => effect.code === 85), null, 2),
    ).toBe(true);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned", "sentToGraveyard", "discarded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: clockWyvern.uid, eventReason: duelReason.material | duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: clockWyvern.uid, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: clockDragon.uid, eventReasonEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: linkMaterial.uid, eventReason: duelReason.material | duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: linkMaterial.uid, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: clockDragon.uid, eventReasonEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: clockDragon.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: searchSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: clockDragon.uid, eventReasonEffectId: 2 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: deckMillTwo.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: clockDragon.uid, eventReasonEffectId: 2 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: searchSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: clockDragon.uid, eventReasonEffectId: 2 },
      { eventName: "discarded", eventCode: 1018, eventCardUid: searchSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: clockDragon.uid, eventReasonEffectId: 2 },
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

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
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
      e:SetOperation(function(e,tp) Debug.Message("clock dragon responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
