import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const crossDebugCode = "9097866";
const allyLinkOneCode = "909786600";
const allyLinkTwoCode = "909786601";
const opponentLinkCode = "909786602";
const graveLinkCode = "909786603";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrossDebugScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crossDebugCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const effectUpdateAttack = 100;
const effectIndestructableBattle = 42;

describe.skipIf(!hasUpstreamScripts || !hasCrossDebugScript)("Lua real script Cross Debug link battle self-banish stat", () => {
  it("restores two-Link hand summon and grave pre-damage Link ATK/protection target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crossDebugCode}.lua`);
    expectCrossDebugScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const handCross = requireCard(restoredSummon.session, crossDebugCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handCross.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === handCross.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handCross.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
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
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handCross.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: handCross.uid,
        eventReasonEffectId: 1,
        previous: "hand",
        current: "monsterZone",
      },
    ]);

    const restoredBattle = createRestoredBattleWindow({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const graveCross = requireCard(restoredBattle.session, crossDebugCode);
    const allyLink = requireCard(restoredBattle.session, allyLinkOneCode);
    const opponentLink = requireCard(restoredBattle.session, opponentLinkCode);
    const graveLink = requireCard(restoredBattle.session, graveLinkCode);
    const trigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveCross.uid && action.effectId === "lua-2-1134"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, trigger!);
    resolveRestoredChain(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === graveCross.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCross.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === allyLink.uid), restoredBattle.session.state)).toBe(3300);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === allyLink.uid && [effectUpdateAttack, effectIndestructableBattle].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableBattle, reset: { flags: 1073741856 }, sourceUid: allyLink.uid, value: 1 },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["beforeDamageCalculation", "banished", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { eventName: "beforeDamageCalculation", eventCode: 1134, eventCardUid: allyLink.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveCross.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveCross.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveLink.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "graveyard" },
    ]);
    finishBattle(restoredBattle.session);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === allyLink.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === opponentLink.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.session.state.battleDamage[1]).toBe(1300);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: crossDebugCode, name: "Cross Debug", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 900, defense: 600 },
    { code: allyLinkOneCode, name: "Cross Debug Ally Link One", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1500, defense: 0, linkMarkers: 0x3 },
    { code: allyLinkTwoCode, name: "Cross Debug Ally Link Two", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1200, defense: 0, linkMarkers: 0x3 },
    { code: opponentLinkCode, name: "Cross Debug Opponent Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 2000, defense: 0, linkMarkers: 0x3 },
    { code: graveLinkCode, name: "Cross Debug Grave Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1800, defense: 0, linkMarkers: 0x3 },
  ];
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 9097866, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [crossDebugCode], extra: [allyLinkOneCode, allyLinkTwoCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, crossDebugCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, allyLinkOneCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyLinkTwoCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crossDebugCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 9097867, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [crossDebugCode], extra: [allyLinkOneCode, graveLinkCode] }, 1: { main: [], extra: [opponentLinkCode] } });
  startDuel(session);
  const cross = requireCard(session, crossDebugCode);
  const allyLink = requireCard(session, allyLinkOneCode);
  const opponentLink = requireCard(session, opponentLinkCode);
  const graveLink = requireCard(session, graveLinkCode);
  moveDuelCard(session.state, cross.uid, "graveyard", 0);
  moveDuelCard(session.state, graveLink.uid, "graveyard", 0);
  moveFaceUpAttack(session, allyLink, 0, 0);
  moveFaceUpAttack(session, opponentLink, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crossDebugCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === allyLink.uid && action.targetUid === opponentLink.uid);
  expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  applyAndAssert(session, attack!);
  passUntilPendingTrigger(session);
  expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCrossDebugScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Cross Debug");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("g:FilterCount(s.cfilter,nil)>=2");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("not a:IsLinkMonster() or not d:IsLinkMonster()");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsType,tp,LOCATION_GRAVE,0,1,1,nil,TYPE_LINK)");
  expect(script).toContain("tc:UpdateAttack(tgc:GetAttack(),RESETS_STANDARD_PHASE_END,c)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    passBattleResponse(session);
  }
}

function passBattleResponse(session: DuelSession): void {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLegalActions(session, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
}

function finishBattle(session: DuelSession): void {
  let guard = 0;
  while ((session.state.pendingBattle || session.state.chain.length > 0) && guard < 20) {
    guard += 1;
    if (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
      if (!pass) break;
      applyAndAssert(session, pass);
      continue;
    }
    if (session.state.pendingTriggers.length > 0) break;
    passBattleResponse(session);
  }
  expect(guard).toBeLessThan(20);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
