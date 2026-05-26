import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gatewayCode = "27970830";
const summonSixCode = "279708300";
const searchSixCode = "279708301";
const reviveShienCode = "279708302";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGatewayScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gatewayCode}.lua`));
const counterBushido = 0x3;
const setShien = 0x20;
const setSixSamurai = 0x3d;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGatewayScript)("Lua real script Gateway of the Six counter search summon stat", () => {
  it("restores Bushido counter placement into ATK boost, search, and Shien revival branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gatewayCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 27970830, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gatewayCode, summonSixCode, searchSixCode, reviveShienCode] }, 1: { main: [] } });
    startDuel(session);

    const gateway = requireCard(session, gatewayCode);
    const summonSix = requireCard(session, summonSixCode);
    const searchSix = requireCard(session, searchSixCode);
    const reviveShien = requireCard(session, reviveShienCode);
    moveFaceUpSpell(session, gateway);
    gateway.counters = { [counterBushido]: 10 };
    moveDuelCard(session.state, summonSix.uid, "hand", 0);
    moveDuelCard(session.state, reviveShien.uid, "graveyard", 0).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gatewayCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === summonSix.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    expect(getDuelCardCounter(restoredSummon.session.state.cards.find((card) => card.uid === gateway.uid), counterBushido)).toBe(12);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: summonSix.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: gateway.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: gateway.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackBoost = getLuaRestoreLegalActions(restoredAttack, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gateway.uid && action.effectId === "lua-5"
    );
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attackBoost!);
    expect(getDuelCardCounter(restoredAttack.session.state.cards.find((card) => card.uid === gateway.uid), counterBushido)).toBe(10);
    resolveRestoredChain(restoredAttack);

    const boostedSix = restoredAttack.session.state.cards.find((card) => card.uid === summonSix.uid);
    expect(currentAttack(boostedSix, restoredAttack.session.state)).toBe(2100);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === summonSix.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: summonSix.uid, value: 500 }]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => ["counterRemoved", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: gateway.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: gateway.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: summonSix.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 5 },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gateway.uid && action.effectId === "lua-6"
    );
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    expect(getDuelCardCounter(restoredSearch.session.state.cards.find((card) => card.uid === gateway.uid), counterBushido)).toBe(6);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchSix.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: gateway.uid,
      reasonEffectId: 6,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${searchSixCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) =>
      ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName) || (event.eventName === "counterRemoved" && event.eventReasonEffectId === 6)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: gateway.uid, eventCode: 0x20000, eventName: "counterRemoved", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: gateway.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
      { eventCardUid: searchSix.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: gateway.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
      { eventCardUid: searchSix.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: gateway.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
      { eventCardUid: searchSix.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: gateway.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
    ]);

    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(restoredSearch.session), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const revive = getLuaRestoreLegalActions(restoredRevive, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gateway.uid && action.effectId === "lua-7"
    );
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, revive!);
    expect(getDuelCardCounter(restoredRevive.session.state.cards.find((card) => card.uid === gateway.uid), counterBushido)).toBe(0);
    resolveRestoredChain(restoredRevive);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === reviveShien.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: gateway.uid,
      reasonEffectId: 7,
    });
    expect(restoredRevive.session.state.eventHistory.filter((event) =>
      (event.eventName === "counterRemoved" && event.eventReasonEffectId === 7) ||
      (event.eventName === "becameTarget" && event.relatedEffectId === 7) ||
      (event.eventName === "specialSummoned" && event.eventCardUid === reviveShien.uid)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: gateway.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: gateway.uid, eventReasonEffectId: 7, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: reviveShien.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 7 },
      { eventCardUid: reviveShien.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: gateway.uid, eventReasonEffectId: 7, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredRevive.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:EnableCounterPermit(COUNTER_BUSHIDO)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_BUSHIDO,2)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_BUSHIDO,2,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_BUSHIDO,4,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter2),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_BUSHIDO,6,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter3,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const gateway = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gatewayCode);
  expect(gateway).toBeDefined();
  return [
    { ...gateway!, kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: summonSixCode, name: "Gateway Summoned Six Samurai", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000, setcodes: [setSixSamurai] },
    { code: searchSixCode, name: "Gateway Search Six Samurai", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000, setcodes: [setSixSamurai] },
    { code: reviveShienCode, name: "Gateway Shien Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 5, attack: 2500, defense: 1400, setcodes: [setShien] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
