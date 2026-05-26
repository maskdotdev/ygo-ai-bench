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
const drillCode = "46221535";
const windCostCode = "462215350";
const windDragonCode = "462215351";
const windWarriorCode = "462215352";
const darkDragonCode = "462215353";
const banishCostCode = "462215354";
const level1DragonCode = "462215355";
const level2DragonDecoyCode = "462215356";
const level1WarriorDecoyCode = "462215357";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDrillScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${drillCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const resetPhaseEnd = 0x40000200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDrillScript)("Lua real script Drill Armed Dragon hand field attack banish search stat", () => {
  it("restores hand cost into WIND Dragon field ATK gain and on-field banish-count Dragon search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${drillCode}.lua`);
    expectDrillScriptShape(script);

    const drillData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === drillCode);
    expect(drillData).toBeDefined();
    const reader = createCardReader([
      drillData!,
      ...fixtureCards(),
    ]);

    const restoredHandOpen = createRestoredHandWindow({ reader, workspace });
    expectCleanRestore(restoredHandOpen);
    expectRestoredLegalActions(restoredHandOpen, 0);
    const handDrill = requireCard(restoredHandOpen.session, drillCode);
    const windCost = requireCard(restoredHandOpen.session, windCostCode);
    const windDragon = requireCard(restoredHandOpen.session, windDragonCode);
    const windWarrior = requireCard(restoredHandOpen.session, windWarriorCode);
    const darkDragon = requireCard(restoredHandOpen.session, darkDragonCode);
    const handAction = getLuaRestoreLegalActions(restoredHandOpen, 0).find(
      (action) => action.type === "activateEffect" && action.uid === handDrill.uid && action.effectId === "lua-1",
    );
    expect(handAction, JSON.stringify(getLuaRestoreLegalActions(restoredHandOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHandOpen, handAction!);
    expect(restoredHandOpen.session.state.chain).toEqual([]);

    const restoredFieldBoost = restoreDuelWithLuaScripts(serializeDuel(restoredHandOpen.session), workspace, reader);
    expectCleanRestore(restoredFieldBoost);
    expectRestoredLegalActions(restoredFieldBoost, 0);
    expect(restoredFieldBoost.session.state.cards.find((card) => card.uid === handDrill.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: handDrill.uid,
      reasonEffectId: 1,
    });
    expect(restoredFieldBoost.session.state.cards.find((card) => card.uid === windCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: handDrill.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredFieldBoost.session.state.cards.find((card) => card.uid === windDragon.uid), restoredFieldBoost.session.state)).toBe(1500);
    expect(currentAttack(restoredFieldBoost.session.state.cards.find((card) => card.uid === windWarrior.uid), restoredFieldBoost.session.state)).toBe(1300);
    expect(currentAttack(restoredFieldBoost.session.state.cards.find((card) => card.uid === darkDragon.uid), restoredFieldBoost.session.state)).toBe(1400);
    expect(restoredFieldBoost.session.state.effects.filter((effect) => effect.sourceUid === handDrill.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        controller: 0,
        event: "continuous",
        luaTargetDescriptor: "target:attribute-race:8:8192",
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: resetPhaseEnd },
        sourceUid: handDrill.uid,
        targetRange: [4, 0],
        value: 300,
      },
    ]);
    expect(restoredFieldBoost.session.state.eventHistory.filter((event) => ["sentToGraveyard", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
    }))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: windCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: handDrill.uid,
        eventReasonEffectId: 1,
        eventUids: undefined,
        eventPlayer: undefined,
        eventValue: undefined,
        relatedEffectId: undefined,
        eventChainDepth: undefined,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: handDrill.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: handDrill.uid,
        eventReasonEffectId: 1,
        eventUids: undefined,
        eventPlayer: undefined,
        eventValue: undefined,
        relatedEffectId: undefined,
        eventChainDepth: undefined,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: windCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: handDrill.uid,
        eventReasonEffectId: 1,
        eventUids: [windCost.uid, handDrill.uid],
        eventPlayer: undefined,
        eventValue: undefined,
        relatedEffectId: undefined,
        eventChainDepth: undefined,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventUids: undefined,
        eventPlayer: 0,
        eventValue: 1,
        relatedEffectId: 1,
        eventChainDepth: 1,
      },
    ]);

    const restoredSearch = createRestoredSearchWindow({ reader, workspace });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchDrill = requireCard(restoredSearch.session, drillCode);
    const banishCost = requireCard(restoredSearch.session, banishCostCode);
    const level1Dragon = requireCard(restoredSearch.session, level1DragonCode);
    const level2DragonDecoy = requireCard(restoredSearch.session, level2DragonDecoyCode);
    const level1WarriorDecoy = requireCard(restoredSearch.session, level1WarriorDecoyCode);
    const searchAction = getLuaRestoreLegalActions(restoredSearch, 0).find(
      (action) => action.type === "activateEffect" && action.uid === searchDrill.uid && action.effectId === "lua-2",
    );
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchAction!);
    expect(restoredSearch.session.state.chain).toEqual([]);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === banishCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: searchDrill.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchDrill.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === level1Dragon.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchDrill.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === level2DragonDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === level1WarriorDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    const searchedPreviousSequence = restoredSearch.session.state.cards.find((card) => card.uid === level1Dragon.uid)?.previousSequence ?? 0;
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      banishedEvent(banishCost.uid, searchDrill.uid),
      sentToHandEvent(level1Dragon.uid, searchDrill.uid, searchedPreviousSequence),
      confirmedEvent(level1Dragon.uid, searchDrill.uid, searchedPreviousSequence),
      sentToHandConfirmedEvent(level1Dragon.uid, searchDrill.uid, searchedPreviousSequence),
      chainSolvedEvent(2),
    ]);
    expect(restoredSearch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: windCostCode, name: "Drill Armed Dragon WIND Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: windDragonCode, name: "Drill Armed Dragon WIND Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
    { code: windWarriorCode, name: "Drill Armed Dragon WIND Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1300, defense: 1000 },
    { code: darkDragonCode, name: "Drill Armed Dragon DARK Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
    { code: banishCostCode, name: "Drill Armed Dragon Banish Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 7, attack: 1800, defense: 1500 },
    { code: level1DragonCode, name: "Drill Armed Dragon Level 1 Search", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 1, attack: 700, defense: 600 },
    { code: level2DragonDecoyCode, name: "Drill Armed Dragon Level 2 Dragon Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 2, attack: 900, defense: 800 },
    { code: level1WarriorDecoyCode, name: "Drill Armed Dragon Level 1 Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 1, attack: 800, defense: 700 },
  ];
}

function createRestoredHandWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 46221535, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [drillCode, windCostCode, windDragonCode, windWarriorCode, darkDragonCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, drillCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, windCostCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, windDragonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, windWarriorCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, darkDragonCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(drillCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSearchWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 46221536, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [drillCode, banishCostCode, level1DragonCode, level2DragonDecoyCode, level1WarriorDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, drillCode), 0, 0);
  const movedCost = moveDuelCard(session.state, requireCard(session, banishCostCode).uid, "graveyard", 0);
  movedCost.faceUp = true;
  movedCost.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(drillCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectDrillScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Drill Armed Dragon");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_WIND) and c:IsAbleToGraveAsCost()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcostfilter,tp,LOCATION_HAND,0,1,1,c)");
  expect(script).toContain("Duel.SendtoGrave(g+c,REASON_COST)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTarget(function(e,c) return c:IsAttribute(ATTRIBUTE_WIND) and c:IsRace(RACE_DRAGON) end)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
  expect(script).toContain("return c:IsRace(RACE_DRAGON) and (c:IsLevelAbove(7) or c:IsAttribute(ATTRIBUTE_WIND)) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,1,#rg,s.rescon,0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,1,#rg,s.rescon,1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("return c:IsRace(RACE_DRAGON) and c:IsLevel(lv) and not c:IsCode(id)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil,e:GetLabel())");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function banishedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "banished",
    eventCode: 1011,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
}

function chainSolvedEvent(effectId: number) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: `chain-${effectId + 1}`,
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
