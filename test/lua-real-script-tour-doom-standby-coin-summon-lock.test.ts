import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const tourCode = "62784717";
const opponentMonsterCode = "627847170";
const controllerMonsterCode = "627847171";
const hasTourScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tourCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const categoryCoin = 0x1000000;
const effectCannotSummon = 20;
const effectCannotFlipSummon = 21;

describe.skipIf(!hasUpstreamScripts || !hasTourScript)("Lua real script Tour of Doom standby coin summon lock", () => {
  it("restores opponent Standby Phase TossCoin into player-target summon and flip-summon locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tourCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tourCode, controllerMonsterCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const tour = requireCard(session, tourCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const controllerMonster = requireCard(session, controllerMonsterCode);
    moveFaceUpSpellTrap(session, tour, 0, 0);
    moveToHand(session, opponentMonster, 1, 0);
    moveToHand(session, controllerMonster, 0, 0);
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "draw";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tourCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 1);
    const standby = getLuaRestoreLegalActions(restoredDraw, 1).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 1), null, 2)).toBeDefined();
    applyRestored(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-4098",
        eventCode: 4098,
        eventName: "phaseStandby",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: tour.uid,
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tour.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "coinTossed"].includes(event.eventName))).toEqual([
      { eventName: "phaseStandby", eventCode: 4098 },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tour.uid,
        eventReasonEffectId: 2,
      },
    ]);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredLock);
    expect(lockEffects(restoredLock.session, tour.uid)).toEqual([
      { code: effectCannotSummon, targetRange: [0, 1], reset: { flags: 0x40000200 } },
      { code: effectCannotFlipSummon, targetRange: [0, 1], reset: { flags: 0x40000200 } },
    ]);
    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActions(restoredLock, 1).filter((action) => action.type === "normalSummon" && action.uid === opponentMonster.uid)).toEqual([]);
    const predicateProbe = restoredLock.host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${opponentMonsterCode}), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("tour summon predicate " .. tostring(Duel.IsPlayerCanSummon(1, locked)))
      `,
      "tour-doom-summon-predicate-probe.lua",
    );
    expect(predicateProbe.ok, predicateProbe.error).toBe(true);
    expect(restoredLock.host.messages).toContain("tour summon predicate false");
    restoredLock.session.state.turnPlayer = 0;
    restoredLock.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "normalSummon" && action.uid === controllerMonster.uid)).toBe(true);
    const openPredicateProbe = restoredLock.host.loadScript(
      `
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${controllerMonsterCode}), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("tour open summon predicate " .. tostring(Duel.IsPlayerCanSummon(0, open)))
      `,
      "tour-doom-open-summon-predicate-probe.lua",
    );
    expect(openPredicateProbe.ok, openPredicateProbe.error).toBe(true);
    expect(restoredLock.host.messages).toContain("tour open summon predicate true");
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Tour of Doom");
  expect(script).toContain("e2:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("e2:SetCondition(function(_,tp) return Duel.IsTurnPlayer(1-tp) end)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SUMMON)");
  expect(script).toContain("e1:SetCondition(function()return Duel.GetTurnCount()~=cur_turn end)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_FLIP_SUMMON)");
  expect(script).toContain("local res=Duel.TossCoin(tp,1)");
  expect(script).toContain("if res==COIN_HEADS then");
  expect(script).toContain("elseif res==COIN_TAILS then");
}

function cards(): DuelCardData[] {
  return [
    { code: tourCode, name: "Tour of Doom", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: opponentMonsterCode, name: "Tour of Doom Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: controllerMonsterCode, name: "Tour of Doom Controller Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveToHand(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "hand", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
  return moved;
}

function lockEffects(session: DuelSession, sourceUid: string): Array<{ code: number | undefined; targetRange: ReadonlyArray<number | undefined> | undefined; reset: unknown }> {
  return session.state.effects
    .filter((effect) => effect.sourceUid === sourceUid && (effect.code === effectCannotSummon || effect.code === effectCannotFlipSummon))
    .map((effect) => ({ code: effect.code, targetRange: effect.targetRange, reset: effect.reset }));
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    const player = restored.session.state.waitingFor ?? 0;
    expectRestoredLegalActions(restored, player);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
