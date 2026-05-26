import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tetherwolfCode = "67922702";
const tokenCode = "67922703";
const genericMechaTokenCode = "31533705";
const defenderCode = "679227020";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTetherwolfScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tetherwolfCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeToken = 0x4000;
const raceMachine = 0x20;
const attributeWind = 0x10;
const setMechaPhantomBeast = 0x101b;
const effectUpdateAttack = 100;
const effectUpdateLevel = 130;
const effectIndestructibleEffect = 41;
const effectIndestructibleBattle = 42;

describe.skipIf(!hasUpstreamScripts || !hasTetherwolfScript)("Lua real script Tetherwolf token level protect stat", () => {
  it("restores summon Token, token-count Level/protection, and damage-step Token release ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectTetherwolfScriptShape(workspace.readScript(`official/c${tetherwolfCode}.lua`));
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const tetherwolf = requireCard(restoredOpen.session, tetherwolfCode);
    const defender = requireCard(restoredOpen.session, defenderCode, 1);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === tetherwolf.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x600, code: 1100, event: "trigger", id: "lua-1-1100", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: undefined, code: effectUpdateLevel, event: "continuous", id: "lua-2-130", property: 0x20000, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: effectIndestructibleBattle, event: "continuous", id: "lua-3-42", property: 0x20000, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: effectIndestructibleEffect, event: "continuous", id: "lua-4-41", property: 0x20000, range: ["monsterZone"], triggerEvent: undefined },
      { category: 0x200000, code: 1002, event: "quick", id: "lua-5-1002", property: 0x4000, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "normalSummon" && action.uid === tetherwolf.uid,
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: tetherwolf.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: tetherwolf.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const tokenSummon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === tetherwolf.uid && action.effectId === "lua-1-1100",
    );
    expect(tokenSummon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, tokenSummon!);
    resolveRestoredChain(restoredTrigger);
    const token = requireCard(restoredTrigger.session, tokenCode);
    expect(token).toMatchObject({
      location: "monsterZone",
      controller: 0,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: tetherwolf.uid,
      reasonEffectId: 1,
    });
    expect(currentLevel(restoredTrigger.session.state.cards.find((card) => card.uid === tetherwolf.uid), restoredTrigger.session.state)).toBe(7);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: token.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: tetherwolf.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredProtection = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredProtection);
    expectRestoredLegalActions(restoredProtection, 0);
    expect(destroyDuelCard(restoredProtection.session.state, tetherwolf.uid, 0, duelReason.effect | duelReason.destroy, 1)).toMatchObject({
      uid: tetherwolf.uid,
      location: "monsterZone",
      controller: 0,
    });
    expect(destroyDuelCard(restoredProtection.session.state, tetherwolf.uid, 0, duelReason.battle | duelReason.destroy, 1)).toMatchObject({
      uid: tetherwolf.uid,
      location: "monsterZone",
      controller: 0,
    });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === tetherwolf.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilRestoredAction(restoredBattle, 0, tetherwolf.uid);
    const quickBoost = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateEffect" && action.uid === tetherwolf.uid && action.effectId === "lua-5-1002",
    );
    expect(quickBoost, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, quickBoost!);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === token.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: tetherwolf.uid,
      reasonEffectId: 5,
    });
    resolveRestoredChain(restoredBattle);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === tetherwolf.uid), restoredBattle.session.state)).toBe(2500);
    expect(currentLevel(restoredBattle.session.state.cards.find((card) => card.uid === tetherwolf.uid), restoredBattle.session.state)).toBe(4);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === tetherwolf.uid)).toMatchObject({ attackModifier: 800 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard"].includes(event.eventName) && event.eventCardUid === token.uid).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: token.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: tetherwolf.uid, eventReasonEffectId: 5, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: token.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: tetherwolf.uid, eventReasonEffectId: 5, previous: "monsterZone", current: "graveyard" },
    ]);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 67922702, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tetherwolfCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, tetherwolfCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode, 1), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tetherwolfCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectTetherwolfScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mecha Phantom Beast Tetherwolf");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,1,tp,0)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,TOKEN_MECHA_PHANTOM_BEAST,SET_MECHA_PHANTOM_BEAST,TYPES_TOKEN,0,0,3,RACE_MACHINE,ATTRIBUTE_WIND)");
  expect(script).toContain("Duel.CreateToken(tp,TOKEN_MECHA_PHANTOM_BEAST_TETHERWOLF)");
  expect(script).toContain("Duel.SpecialSummon(token,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsCode,TOKEN_MECHA_PHANTOM_BEAST),c:GetControler(),LOCATION_MZONE,0,nil):GetSum(Card.GetLevel)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e4:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.tknfilter,e:GetHandlerPlayer(),LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("e5:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsType,1,false,nil,nil,TYPE_TOKEN)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsType,1,1,false,nil,nil,TYPE_TOKEN)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("c:UpdateAttack(800,RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: tetherwolfCode, name: "Mecha Phantom Beast Tetherwolf", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMechaPhantomBeast], race: raceMachine, attribute: attributeWind, level: 4, attack: 1700, defense: 1200 },
    { code: tokenCode, alias: genericMechaTokenCode, name: "Mecha Phantom Beast Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, setcodes: [setMechaPhantomBeast], race: raceMachine, attribute: attributeWind, level: 3, attack: 0, defense: 0 },
    { code: defenderCode, name: "Tetherwolf Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
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

function passUntilRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === uid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
