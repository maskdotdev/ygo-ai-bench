import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { normalSummon } from "#duel/summon.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dimerCode = "90965652";
const catalystCode = "65959844";
const burnoutCode = "25669282";
const chemicritterCode = "18993198";
const geminiCode = "3918345";
const allyCode = "909656520";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDimerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dimerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceAqua = 0x40;
const attributeWater = 0x10;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDimerScript)("Lua real script Dimer Synthesis search Gemini stat", () => {
  it("restores SelectEffect search and grave Gemini-status ATK transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dimerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const searchPrompts = [{ api: "SelectEffect" as const, player: 0 as const, returned: 2 }];

    const searchSession = createDuel({ seed: 90965652, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(searchSession, { 0: { main: [dimerCode, catalystCode, burnoutCode, chemicritterCode] }, 1: { main: [] } });
    startDuel(searchSession);
    const searchDimer = requireCard(searchSession, dimerCode);
    const burnout = requireCard(searchSession, burnoutCode);
    const chemicritter = requireCard(searchSession, chemicritterCode);
    moveDuelCard(searchSession.state, searchDimer.uid, "hand", 0);
    searchSession.state.phase = "main1";
    searchSession.state.turnPlayer = 0;
    searchSession.state.waitingFor = 0;
    const searchHost = createLuaScriptHost(searchSession, workspace, { promptOverrides: searchPrompts });
    expect(searchHost.loadCardScript(Number(dimerCode), workspace).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, reader, { promptOverrides: searchPrompts });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchActivation = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateEffect" && action.uid === searchDimer.uid
    );
    expect(searchActivation, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchActivation!);
    expect(restoredSearch.host.promptDecisions.map((prompt) => ({
      api: prompt.api,
      options: "options" in prompt ? prompt.options : undefined,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectEffect", options: [1, 2], player: 0, returned: 2 }]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredSearch.session), workspace, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    resolveRestoredChain(restoredSearchChain);
    expect(findCard(restoredSearchChain.session, burnout.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchDimer.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredSearchChain.session, chemicritter.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchDimer.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) =>
      ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      ...(event.eventUids === undefined ? {} : { eventUids: event.eventUids }),
    }))).toEqual([
      { eventCardUid: burnout.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: searchDimer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: chemicritter.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: searchDimer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: burnout.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: searchDimer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: [burnout.uid, chemicritter.uid] },
      { eventCardUid: burnout.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchDimer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: [burnout.uid, chemicritter.uid] },
      { eventCardUid: burnout.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchDimer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: [burnout.uid, chemicritter.uid] },
    ]);

    const statSession = createDuel({ seed: 90965653, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [dimerCode, geminiCode, allyCode] }, 1: { main: [] } });
    startDuel(statSession);
    const statDimer = requireCard(statSession, dimerCode);
    const gemini = requireCard(statSession, geminiCode);
    const ally = requireCard(statSession, allyCode);
    moveDuelCard(statSession.state, statDimer.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(statSession, gemini, 0, 0);
    moveFaceUpAttack(statSession, ally, 0, 1);
    statSession.state.players[0].normalSummonAvailable = true;
    normalSummon(statSession.state, 0, gemini.uid, () => {}, () => false, () => true);
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(dimerCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    assertGeminiStatus(restoredStat, geminiCode, allyCode);
    const statActivation = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statDimer.uid
    );
    expect(statActivation, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statActivation!);

    const restoredStatChain = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredStatChain);
    expectRestoredLegalActions(restoredStatChain, 1);
    resolveRestoredChain(restoredStatChain);
    expect(findCard(restoredStatChain.session, statDimer.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statDimer.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(findCard(restoredStatChain.session, gemini.uid), restoredStatChain.session.state)).toBe(0);
    expect(currentAttack(findCard(restoredStatChain.session, ally.uid), restoredStatChain.session.state)).toBe(2500);
    expect(restoredStatChain.session.state.effects.filter((effect) =>
      effect.sourceUid === gemini.uid && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: gemini.uid, value: 0 },
    ]);
    expect(restoredStatChain.session.state.eventHistory.filter((event) =>
      ["banished", "becameTarget"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: statDimer.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: statDimer.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: gemini.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: ally.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredStatChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dimer Synthesis");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,op+1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.GetMatchingGroup(s.codefilter,tp,LOCATION_DECK,0,nil,25669282)");
  expect(script).toContain("aux.SelectUnselectGroup(g1+g2,e,tp,2,2,s.threscon,1,tp,HINTMSG_ATOHAND)");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.atkrescon,0,tp)");
  expect(script).toContain("Duel.SetTargetCard(sg)");
  expect(script).toContain("sg:IsExists(Card.IsGeminiStatus,1,nil)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("EFFECT_SET_ATTACK_FINAL");
  expect(script).toContain("tc2:UpdateAttack(tc1:GetBaseAttack(),RESETS_STANDARD_PHASE_END,c)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const official = workspace.readDatabaseCards("cards.cdb").filter((card) =>
    [dimerCode, catalystCode, burnoutCode, chemicritterCode, geminiCode].includes(card.code)
  );
  expect(official.map((card) => card.code).sort()).toEqual([burnoutCode, catalystCode, chemicritterCode, dimerCode, geminiCode].sort());
  return [
    ...official,
    { code: allyCode, name: "Dimer Synthesis ATK Receiver", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, geminiCodeToProbe: string, decoyCode: string): void {
  const result = restored.host.loadScript(
    `
      local gemini = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${geminiCodeToProbe}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local decoy = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${decoyCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("dimer synthesis gemini status " .. tostring(gemini and gemini:IsGeminiStatus()) .. "/" .. tostring(decoy and decoy:IsGeminiStatus()))
    `,
    "dimer-synthesis-gemini-status-probe.lua",
  );
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages).toContain("dimer synthesis gemini status true/false");
}
