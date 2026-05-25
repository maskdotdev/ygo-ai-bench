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
const gorgonCode = "43426903";
const targetCode = "434269030";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGorgonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gorgonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectSetAttackFinal = 99;
const effectCannotChangePosition = 55;
const effectFlagClientHint = 0x4000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGorgonScript)("Lua real script Reptilianne Gorgon battled zero position lock", () => {
  it("restores EVENT_BATTLED attacked monster final ATK zero and cannot-change-position client hint", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gorgonCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const gorgon = requireCard(restored.session, gorgonCode);
    const target = requireCard(restored.session, targetCode);

    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === gorgon.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passRestoredBattleUntil(restored, () => restored.session.state.pendingTriggers.some((trigger) => trigger.effectId === "lua-1-1138"));

    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 100 });
    expect(restored.session.state.players[1]?.lifePoints).toBe(7900);
    expect(restored.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1138",
        eventCardUid: gorgon.uid,
        eventCode: 1138,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "afterDamageCalculation",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [gorgon.uid, target.uid],
        id: "trigger-5-1",
        player: 0,
        sourceUid: gorgon.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === gorgon.uid && action.effectId === "lua-1-1138"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, target.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [effectSetAttackFinal, effectCannotChangePosition].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, description: undefined, property: undefined, reset: { flags: 33492992 }, sourceUid: target.uid, value: 0 },
      { code: effectCannotChangePosition, description: 3313, property: effectFlagClientHint, reset: { flags: 33492992 }, sourceUid: target.uid, value: undefined },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleDamageDealt", "afterDamageCalculation"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      eventValue: event.eventValue,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: gorgon.uid, eventCode: 1143, eventName: "battleDamageDealt", eventPlayer: 1, eventReason: duelReason.battle, eventReasonCardUid: gorgon.uid, eventReasonPlayer: 0, eventUids: undefined, eventValue: 100, previous: "deck" },
      { current: "monsterZone", eventCardUid: gorgon.uid, eventCode: 1138, eventName: "afterDamageCalculation", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonPlayer: 0, eventUids: [gorgon.uid, target.uid], eventValue: undefined, previous: "deck" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const gorgon = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gorgonCode);
  expect(gorgon).toBeDefined();
  return [
    gorgon!,
    { code: targetCode, name: "Reptilianne Gorgon Fixture Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1300, defense: 1000 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 43426903, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gorgonCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, gorgonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gorgonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Reptilianne Gorgon");
  expect(script).toContain("e1:SetCode(EVENT_BATTLED)");
  expect(script).toContain("return e:GetHandler()==Duel.GetAttacker() and Duel.GetAttackTarget()");
  expect(script).toContain("local d=Duel.GetAttackTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetDescription(3313)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
  expect(script).toContain("e2:SetReset(RESET_EVENT|RESETS_STANDARD)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restored, pass!);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
