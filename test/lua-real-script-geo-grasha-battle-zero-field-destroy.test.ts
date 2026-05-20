import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const geoCode = "71101678";
const battleTargetCode = "711016781";
const destroySeedCode = "711016782";
const opponentFieldCode = "711016783";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGeoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${geoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const setEarthbound = 0x21;

describe.skipIf(!hasUpstreamScripts || !hasGeoScript)("Lua real script Geo Grasha battle zero field destroy", () => {
  it("restores battle-start ATK/DEF zero and destroyed-opponent-monster field wipe", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${geoCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,s.matfilter(TYPE_FUSION),s.matfilter(TYPE_SYNCHRO))");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("local bc=e:GetHandler():GetBattleTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_ONFIELD)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: geoCode, name: "Earthbound Servant Geo Grasha", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, setcodes: [setEarthbound], level: 10, attack: 3000, defense: 1800 },
      { code: battleTargetCode, name: "Geo Grasha Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2400, defense: 2000 },
      { code: destroySeedCode, name: "Geo Grasha Destroyed Seed", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: opponentFieldCode, name: "Geo Grasha Opponent Field", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 71101678, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [geoCode] }, 1: { main: [battleTargetCode, destroySeedCode, opponentFieldCode] } });
    startDuel(session);

    const geo = requireCard(session, geoCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const destroySeed = requireCard(session, destroySeedCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveFaceUpAttack(session, geo, 0);
    geo.summonType = "fusion";
    moveFaceUpAttack(session, battleTarget, 1);
    moveFaceUpAttack(session, destroySeed, 1);
    moveFaceUpAttack(session, opponentField, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(geoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === geo.uid && action.targetUid === battleTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passAttackResponsesUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: geo.uid,
        eventCode: 1132,
        eventName: "battleStarted",
        eventUids: [geo.uid, battleTarget.uid],
        sourceUid: geo.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === geo.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleTrigger, battleTrigger!);
    resolveRestoredChain(restoredBattleTrigger);
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredBattleTrigger.session.state)).toBe(0);
    expect(currentDefense(restoredBattleTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredBattleTrigger.session.state)).toBe(0);

    restoredBattleTrigger.session.state.waitingFor = 0;
    const destroyProbe = restoredBattleTrigger.host.loadScript(`
      local seed=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${destroySeedCode}),0,0,LOCATION_MZONE,nil)
      Duel.Destroy(seed,REASON_EFFECT)
    `, "geo-grasha-destroyed-seed-probe.lua");
    expect(destroyProbe.ok, destroyProbe.error).toBe(true);
    expect(restoredBattleTrigger.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: destroySeed.uid,
        eventCode: 1029,
        eventName: "destroyed",
        sourceUid: geo.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleTrigger.session), workspace, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === geo.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    expect(destroyedTrigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredDestroyedTrigger, destroyedTrigger!);
    resolveRestoredChain(restoredDestroyedTrigger);
    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === opponentField.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: geo.uid,
      reasonEffectId: 4,
    });
    expect(restoredDestroyedTrigger.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === destroySeed.uid).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroySeed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
      },
    ]);
    expect(restoredDestroyedTrigger.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === opponentField.uid).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentField.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: geo.uid,
        eventReasonEffectId: 4,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passAttackResponsesUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
