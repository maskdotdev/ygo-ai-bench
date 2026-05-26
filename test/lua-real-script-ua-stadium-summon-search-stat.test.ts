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
const stadiumCode = "19814508";
const normalUaCode = "198145080";
const searchUaCode = "198145081";
const specialUaCode = "198145082";
const specialStarterCode = "198145083";
const allyCode = "198145084";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasStadiumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${stadiumCode}.lua`));
const setUa = 0xb2;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasStadiumScript)("Lua real script U.A. Stadium summon search stat", () => {
  it("restores Field Spell Normal Summon search and Special Summon global ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${stadiumCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));

    const search = createRestoredSearchField({ reader, source, workspace });
    expectCleanRestore(search.restored);
    expectRestoredLegalActions(search.restored, 0);
    const normalSummon = getLuaRestoreLegalActions(search.restored, 0).find((action) =>
      action.type === "normalSummon" && action.uid === search.normal.uid
    );
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(search.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search.restored, normalSummon!);

    const restoredSearchTrigger = restoreDuelWithLuaScripts(serializeDuel(search.restored.session), source, reader);
    expectCleanRestore(restoredSearchTrigger);
    expectRestoredLegalActions(restoredSearchTrigger, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearchTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === search.stadium.uid
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearchTrigger, 0), null, 2)).toBeDefined();
    if (!searchTrigger || searchTrigger.type !== "activateTrigger") throw new Error("Missing U.A. Stadium search trigger");
    const searchEffectId = Number(searchTrigger.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredSearchTrigger, searchTrigger);
    resolveRestoredChain(restoredSearchTrigger);

    expect(findCard(restoredSearchTrigger.session, search.searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: search.stadium.uid,
      reasonEffectId: searchEffectId,
    });
    expect(restoredSearchTrigger.host.messages).toContain(`confirmed 1: ${searchUaCode}`);
    expect(restoredSearchTrigger.session.state.eventHistory.filter((event) =>
      ["normalSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
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
      { eventCardUid: search.normal.uid, eventCode: 1100, eventName: "normalSummoned", eventPlayer: undefined, eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: search.searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: search.stadium.uid, eventReasonEffectId: searchEffectId, eventReasonPlayer: 0 },
      { eventCardUid: search.searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: search.stadium.uid, eventReasonEffectId: searchEffectId, eventReasonPlayer: 0 },
      { eventCardUid: search.searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: search.stadium.uid, eventReasonEffectId: searchEffectId, eventReasonPlayer: 0 },
    ]);
    expect(restoredSearchTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const boost = createRestoredBoostField({ reader, source, workspace });
    expectCleanRestore(boost.restored);
    expectRestoredLegalActions(boost.restored, 0);
    const summonAction = getLuaRestoreLegalActions(boost.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === boost.starter.uid
    );
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(boost.restored, 0), null, 2)).toBeDefined();
    if (!summonAction || summonAction.type !== "activateEffect") throw new Error("Missing U.A. fixture Special Summon starter");
    const starterEffectId = Number(summonAction.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(boost.restored, summonAction);
    resolveRestoredChain(boost.restored);

    expect(findCard(boost.restored.session, boost.special.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: boost.starter.uid,
      reasonEffectId: starterEffectId,
    });
    const restoredBoostTrigger = restoreDuelWithLuaScripts(serializeDuel(boost.restored.session), source, reader);
    expectCleanRestore(restoredBoostTrigger);
    expectRestoredLegalActions(restoredBoostTrigger, 0);
    const boostTrigger = getLuaRestoreLegalActions(restoredBoostTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === boost.stadium.uid
    );
    expect(boostTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBoostTrigger, 0), null, 2)).toBeDefined();
    if (!boostTrigger || boostTrigger.type !== "activateTrigger") throw new Error("Missing U.A. Stadium ATK trigger");
    const boostEffectId = Number(boostTrigger.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredBoostTrigger, boostTrigger);
    resolveRestoredChain(restoredBoostTrigger);

    expect(currentAttack(findCard(restoredBoostTrigger.session, boost.starter.uid), restoredBoostTrigger.session.state)).toBe(1500);
    expect(currentAttack(findCard(restoredBoostTrigger.session, boost.ally.uid), restoredBoostTrigger.session.state)).toBe(1500);
    expect(currentAttack(findCard(restoredBoostTrigger.session, boost.special.uid), restoredBoostTrigger.session.state)).toBe(2100);
    expect(restoredBoostTrigger.session.state.effects.filter((effect) =>
      [boost.starter.uid, boost.ally.uid, boost.special.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: boost.starter.uid, value: 500 },
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: boost.ally.uid, value: 500 },
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: boost.special.uid, value: 500 },
    ]);
    expect(restoredBoostTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: boost.special.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: boost.starter.uid, eventReasonEffectId: starterEffectId, eventReasonPlayer: 0 },
    ]);
    expect(boostEffectId).toBe(3);
    expect(restoredBoostTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

type ScriptSource = { readScript(name: string): string | undefined };

function createRestoredSearchField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  stadium: DuelCardInstance;
  normal: DuelCardInstance;
  searchTarget: DuelCardInstance;
} {
  const session = createDuel({ seed: 19814508, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [stadiumCode, normalUaCode, searchUaCode] }, 1: { main: [] } });
  startDuel(session);

  const stadium = requireCard(session, stadiumCode);
  const normal = requireCard(session, normalUaCode);
  const searchTarget = requireCard(session, searchUaCode);
  moveFaceUpFieldSpell(session, stadium, 0);
  moveDuelCard(session.state, normal.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(stadiumCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  return { restored, stadium, normal, searchTarget };
}

function createRestoredBoostField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  stadium: DuelCardInstance;
  starter: DuelCardInstance;
  ally: DuelCardInstance;
  special: DuelCardInstance;
} {
  const session = createDuel({ seed: 19814509, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [stadiumCode, specialStarterCode, allyCode, specialUaCode] }, 1: { main: [] } });
  startDuel(session);

  const stadium = requireCard(session, stadiumCode);
  const starter = requireCard(session, specialStarterCode);
  const ally = requireCard(session, allyCode);
  const special = requireCard(session, specialUaCode);
  moveFaceUpFieldSpell(session, stadium, 0);
  moveFaceUpAttack(session, starter, 0, 0);
  moveFaceUpAttack(session, ally, 0, 1);
  moveDuelCard(session.state, special.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(stadiumCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(specialStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  return { restored, stadium, starter, ally, special };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("U.A. Stadium");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("eg:IsExists(s.cfilter,1,nil,tp)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetValue(500)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const stadium = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === stadiumCode);
  expect(stadium).toBeDefined();
  return [
    { ...stadium!, kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setUa] },
    uaMonster(normalUaCode, "U.A. Stadium Normal U.A.", 1500, 1200),
    uaMonster(searchUaCode, "U.A. Stadium Search U.A.", 1400, 1000),
    uaMonster(specialUaCode, "U.A. Stadium Special U.A.", 1600, 1000),
    { code: specialStarterCode, name: "U.A. Stadium Special Summoner", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, race: raceWarrior, attribute: attributeEarth },
    { code: allyCode, name: "U.A. Stadium Non-U.A. Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, race: raceWarrior, attribute: attributeEarth },
  ];
}

function uaMonster(code: string, name: string, attack: number, defense: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    level: 4,
    attack,
    defense,
    race: raceWarrior,
    attribute: attributeEarth,
    setcodes: [setUa],
  };
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${specialStarterCode}.lua`) return specialStarterScript();
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function specialStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${specialUaCode}),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
      c:RegisterEffect(e)
    end
  `;
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

function moveFaceUpFieldSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = 5;
  return moved;
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
