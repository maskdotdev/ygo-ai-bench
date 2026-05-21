import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense, currentRace } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const eldoniaCode = "2376209";
const trapActivatorCode = "23762090";
const targetCode = "23762091";
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeNormal = 0x10;
const typeEffect = 0x20;
const raceAqua = 0x40;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Paleozoic Eldonia update trap monster", () => {
  it("restores target ATK/DEF update and graveyard Trap response into self trap-monster redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${eldoniaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("return re:IsTrapEffect() and re:IsHasType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id,SET_PALEOZOIC,TYPE_MONSTER|TYPE_NORMAL,1200,0,2,RACE_AQUA,ATTRIBUTE_WATER)");
    expect(script).toContain("c:AddMonsterAttribute(TYPE_NORMAL)");
    expect(script).toContain("c:AssumeProperty(ASSUME_RACE,RACE_AQUA)");
    expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,true,false,POS_FACEUP)");
    expect(script).toContain("c:AddMonsterAttributeComplete()");
    expect(script).toContain("EFFECT_IMMUNE_EFFECT");
    expect(script).toContain("EFFECT_LEAVE_FIELD_REDIRECT");
    expect(script).toContain("Duel.SpecialSummonComplete()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === eldoniaCode),
      { code: trapActivatorCode, name: "Paleozoic Eldonia Chain Trap", kind: "trap", typeFlags: typeTrap },
      { code: targetCode, name: "Paleozoic Eldonia Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 2000, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${trapActivatorCode}.lua`) return chainTrapScript();
        return workspace.readScript(name);
      },
    };

    const statSession = createDuel({ seed: 2376209, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [eldoniaCode] }, 1: { main: [targetCode] } });
    startDuel(statSession);
    const statEldonia = requireCard(statSession, eldoniaCode);
    const statTarget = requireCard(statSession, targetCode);
    const setEldonia = moveDuelCard(statSession.state, statEldonia.uid, "spellTrapZone", 0);
    setEldonia.position = "faceDown";
    setEldonia.faceUp = false;
    moveDuelCard(statSession.state, statTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    statTarget.faceUp = true;
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(eldoniaCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStatOpen = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStatOpen);
    expectRestoredLegalActions(restoredStatOpen, 0);
    const statActivation = getLuaRestoreLegalActions(restoredStatOpen, 0).find((action) => action.type === "activateEffect" && action.uid === statEldonia.uid);
    expect(statActivation, JSON.stringify(getLuaRestoreLegalActions(restoredStatOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStatOpen, statActivation!);
    expect(restoredStatOpen.session.state.chain).toEqual([]);
    expect(currentAttack(restoredStatOpen.session.state.cards.find((card) => card.uid === statTarget.uid), restoredStatOpen.session.state)).toBe(2500);
    expect(currentDefense(restoredStatOpen.session.state.cards.find((card) => card.uid === statTarget.uid), restoredStatOpen.session.state)).toBe(2100);
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === statEldonia.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.rule });
    expect(restoredStatOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: statTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);

    const summonSession = createDuel({ seed: 2376210, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [eldoniaCode, trapActivatorCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonEldonia = requireCard(summonSession, eldoniaCode);
    const trapActivator = requireCard(summonSession, trapActivatorCode);
    moveDuelCard(summonSession.state, summonEldonia.uid, "graveyard", 0);
    const setTrapActivator = moveDuelCard(summonSession.state, trapActivator.uid, "spellTrapZone", 0);
    setTrapActivator.position = "faceDown";
    setTrapActivator.faceUp = false;
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;
    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(eldoniaCode), source).ok).toBe(true);
    expect(summonHost.loadCardScript(Number(trapActivatorCode), source).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(2);

    const trapActivation = getLegalActions(summonSession, 0).find((action) => action.type === "activateEffect" && action.uid === trapActivator.uid);
    expect(trapActivation, JSON.stringify(getLegalActions(summonSession, 0), null, 2)).toBeDefined();
    applyAndAssert(summonSession, trapActivation!);
    expect(summonSession.state.chain[0]).not.toHaveProperty("operationInfos");
    expect(summonSession.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-3-1002",
        id: "chain-2",
        player: 0,
        sourceUid: trapActivator.uid,
      },
    ]);

    const restoredChainOpen = restoreDuelWithLuaScripts(serializeDuel(summonSession), source, reader);
    expectCleanRestore(restoredChainOpen);
    expectRestoredLegalActions(restoredChainOpen, 0);
    const graveResponse = getLuaRestoreLegalActions(restoredChainOpen, 0).find((action) => action.type === "activateEffect" && action.uid === summonEldonia.uid);
    expect(graveResponse, JSON.stringify(getLuaRestoreLegalActions(restoredChainOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredChainOpen, graveResponse!);
    expect(restoredChainOpen.session.state.chain).toEqual([]);
    expect(restoredChainOpen.host.messages).toContain("paleozoic eldonia trap resolved");
    const summonedEldonia = restoredChainOpen.session.state.cards.find((card) => card.uid === summonEldonia.uid);
    expect(summonedEldonia).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonEldonia.uid,
      reasonEffectId: 2,
      data: { typeFlags: typeMonster | typeNormal, attack: 1200, defense: 0 },
    });
    expect(currentRace(summonedEldonia, restoredChainOpen.session.state)).toBe(raceAqua);
    expect(restoredChainOpen.session.state.effects.some((effect) => effect.sourceUid === summonEldonia.uid && effect.code === 1 && effect.luaValueDescriptor === "immune-effect:monster-effects")).toBe(true);
    expect(restoredChainOpen.session.state.effects.some((effect) => effect.sourceUid === summonEldonia.uid && effect.code === 60 && effect.value === 0x20)).toBe(true);
    expect(restoredChainOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summonEldonia.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonEldonia.uid,
        eventUids: [summonEldonia.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonEldonia.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredChainOpen.session), source, reader);
    expectCleanRestore(restoredRedirect);
    expectRestoredLegalActions(restoredRedirect, 0);
    sendDuelCardToGraveyard(restoredRedirect.session.state, summonEldonia.uid, 0, duelReason.effect, 0, { eventReasonCardUid: trapActivator.uid });
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === summonEldonia.uid)).toMatchObject({
      location: "banished",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.redirect,
      reasonPlayer: 0,
    });
  });
});

function chainTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("paleozoic eldonia trap resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
