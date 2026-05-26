import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const headbattCode = "54088068";
const costCode = "540880680";
const targetCode = "540880681";
const searchCode = "540880682";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasHeadbattScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${headbattCode}.lua`));
const setGouki = 0xfc;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHeadbattScript)("Lua real script Gouki Headbatt cost summon attack to-Grave search stat", () => {
  it("restores selected Gouki hand cost into targeted DEF Special Summon, ATK gain, and delayed to-Grave search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${headbattCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredHeadbattField({ reader, workspace, scenario: "summon" });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonHeadbatt = requireCard(restoredSummon.session, headbattCode);
    const summonCost = requireCard(restoredSummon.session, costCode);
    const summonTarget = requireCard(restoredSummon.session, targetCode);
    const summonAction = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonHeadbatt.uid && action.effectId === "lua-1"
    );
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonAction!);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: summonHeadbatt.uid,
      reasonEffectId: 1,
    });
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonHeadbatt.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonHeadbatt.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === summonTarget.uid), restoredSummon.session.state)).toBe((summonTarget.data.attack ?? 0) + 800);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === summonTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169792 }, sourceUid: summonTarget.uid, value: 800 },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: summonCost.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: summonHeadbatt.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: summonTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: 1 },
      { eventCardUid: summonHeadbatt.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: summonHeadbatt.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", current: "monsterZone", relatedEffectId: undefined },
    ]);

    const restoredSearch = createRestoredHeadbattField({ reader, workspace, scenario: "search" });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchHeadbatt = requireCard(restoredSearch.session, headbattCode);
    const searchTarget = requireCard(restoredSearch.session, searchCode);
    expect(restoredSearch.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1014", eventCardUid: searchHeadbatt.uid, eventCode: 1014, eventName: "sentToGraveyard", player: 0, sourceUid: searchHeadbatt.uid, triggerBucket: "turnOptional" },
    ]);
    const searchAction = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === searchHeadbatt.uid
    );
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchAction!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchHeadbatt.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: searchHeadbatt.uid, eventCode: 1014, eventName: "sentToGraveyard", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: searchHeadbatt.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchHeadbatt.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchHeadbatt.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
    ]);
    expect(restoredSearch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredHeadbattField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "summon" | "search";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "summon" ? 54088068 : 54088069, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  const playerMain = scenario === "summon" ? [headbattCode, costCode, targetCode] : [headbattCode, searchCode];
  loadDecks(session, { 0: { main: playerMain }, 1: { main: [] } });
  startDuel(session);
  const headbatt = requireCard(session, headbattCode);
  if (scenario === "summon") {
    moveDuelCard(session.state, headbatt.uid, "hand", 0);
    moveDuelCard(session.state, requireCard(session, costCode).uid, "hand", 0);
    moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
  } else {
    moveFaceUpAttack(session, headbatt, 0, 0);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(headbattCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  if (scenario === "search") {
    sendDuelCardToGraveyard(session.state, headbatt.uid, 0, duelReason.effect, 0);
  }
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gouki Headbatt");
  expect(script).toContain("s.listed_series={SET_GOUKI}");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("return c:IsMonster() and c:IsSetCard(SET_GOUKI) and c:IsAbleToGraveAsCost()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spcfilter,tp,LOCATION_HAND,0,1,1,c)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(800)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("return c:IsSetCard(SET_GOUKI) and not c:IsCode(id) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const headbatt = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === headbattCode);
  expect(headbatt).toBeDefined();
  return [
    { ...headbatt!, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 2, attack: 800, defense: 0, setcodes: [setGouki] },
    { code: costCode, name: "Gouki Headbatt Hand Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000, setcodes: [setGouki] },
    { code: targetCode, name: "Gouki Headbatt Field Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000, setcodes: [setGouki] },
    { code: searchCode, name: "Gouki Headbatt Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000, setcodes: [setGouki] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
