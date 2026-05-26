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
const overdragonCode = "37440988";
const crystalGraveCode = "374409880";
const ownFieldCode = "374409881";
const opponentFieldCode = "374409882";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOverdragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${overdragonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceDragon = 0x2000;
const raceBeast = 0x4000;
const attributeLight = 0x10;
const attributeEarth = 0x8;
const setCrystalBeast = 0x1034;
const setUltimateCrystal = 0x103;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasOverdragonScript)("Lua real script Rainbow Overdragon banish stat self-tribute to-Deck", () => {
  it("restores Crystal Beast grave banish cost into temporary ATK gain", () => {
    const { workspace, reader, session } = createOverdragonSession(37440988);
    const overdragon = requireCard(session, overdragonCode);
    const crystal = requireCard(session, crystalGraveCode);
    moveFaceUpAttack(session, overdragon, 0, 0);
    moveDuelCard(session.state, crystal.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(overdragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === overdragon.uid && action.effectId === "lua-4"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === crystal.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: overdragon.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === overdragon.uid), restoredOpen.session.state)).toBe(5800);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: overdragon.uid, value: 1800 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: crystal.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: overdragon.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores fusion-summoned SelfTribute quick effect into field shuffle", () => {
    const { workspace, reader, session } = createOverdragonSession(37440989);
    const overdragon = requireCard(session, overdragonCode);
    const ownField = requireCard(session, ownFieldCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveFaceUpAttack(session, overdragon, 0, 0);
    overdragon.summonType = "fusion";
    moveFaceUpAttack(session, ownField, 0, 1);
    moveFaceUpAttack(session, opponentField, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(overdragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const shuffle = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === overdragon.uid && action.effectId === "lua-5-1002"
    );
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, shuffle!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === overdragon.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: overdragon.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownField.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: overdragon.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentField.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: overdragon.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["released", "sentToDeck"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: overdragon.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: overdragon.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: ownField.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: overdragon.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
      { eventCardUid: opponentField.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: overdragon.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
      { eventCardUid: ownField.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: overdragon.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createOverdragonSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${overdragonCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [crystalGraveCode, ownFieldCode], extra: [overdragonCode] },
    1: { main: [opponentFieldCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Rainbow Overdragon");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_CRYSTAL_BEAST),7)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.CheckReleaseGroup(tp,s.hspfilter,1,false,1,true,c,tp,nil,false,nil,tp,c)");
  expect(script).toContain("Duel.SelectReleaseGroup(tp,s.hspfilter,1,1,false,true,true,c,nil,nil,false,nil,tp,c)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e4:SetCost(Cost.SelfTribute)");
  expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: overdragonCode, name: "Rainbow Overdragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceDragon, attribute: attributeLight, level: 12, attack: 4000, defense: 0, setcodes: [setUltimateCrystal], fusionMaterialSetcode: setCrystalBeast, fusionMaterialMin: 7, fusionMaterialMax: 7 },
    { code: crystalGraveCode, name: "Rainbow Overdragon Crystal Beast Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200, setcodes: [setCrystalBeast] },
    { code: ownFieldCode, name: "Rainbow Overdragon Own Field", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000, setcodes: [setCrystalBeast] },
    { code: opponentFieldCode, name: "Rainbow Overdragon Opponent Field", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1500, defense: 1500 },
  ];
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
