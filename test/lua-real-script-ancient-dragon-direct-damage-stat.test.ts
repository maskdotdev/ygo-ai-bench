import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
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
const ancientDragonCode = "38520918";
const hasAncientDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ancientDragonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasAncientDragonScript)("Lua real script Ancient Dragon direct damage stat", () => {
  it("restores direct battle damage into copied ATK and Level updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ancientDragonCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("return ep~=tp and Duel.GetAttackTarget()==nil");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
    expect(script).toContain("e1:SetValue(500)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_LEVEL)");
    expect(script).toContain("e2:SetValue(1)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 38520918, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ancientDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const ancientDragon = requireCard(session, ancientDragonCode);
    moveFaceUpAttack(session, ancientDragon, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ancientDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.effects.find((effect) => effect.sourceUid === ancientDragon.uid && effect.code === 1143)).toMatchObject({
      category: 0x200000,
      code: 1143,
      event: "trigger",
      optional: true,
      sourceUid: ancientDragon.uid,
      triggerEvent: "battleDamageDealt",
    });

    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === ancientDragon.uid && action.directAttack,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);

    expect(restoredBattle.session.state.players[1]!.lifePoints).toBe(6600);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-1-1143",
        eventCardUid: ancientDragon.uid,
        eventCode: 1143,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle,
        eventReasonCardUid: ancientDragon.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventValue: 1400,
        player: 0,
        sourceUid: ancientDragon.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === ancientDragon.uid && action.effectId === "lua-1-1143",
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ancientDragon.uid), restoredTrigger.session.state)).toBe(1900);
    expect(currentLevel(restoredTrigger.session.state.cards.find((card) => card.uid === ancientDragon.uid), restoredTrigger.session.state)).toBe(5);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === ancientDragon.uid && (effect.code === 100 || effect.code === 130)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x2000, reset: { flags: 33492992 }, sourceUid: ancientDragon.uid, value: 500 },
      { code: 130, property: 0x2000, reset: { flags: 33492992 }, sourceUid: ancientDragon.uid, value: 1 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared" || event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: ancientDragon.uid,
        eventReasonPlayer: 0,
        eventReason: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: ancientDragon.uid,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: ancientDragon.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventPlayer: 1,
        eventValue: 1400,
      },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === ancientDragon.uid), restoredStat.session.state)).toBe(1900);
    expect(currentLevel(restoredStat.session.state.cards.find((card) => card.uid === ancientDragon.uid), restoredStat.session.state)).toBe(5);
  });
});

function cards(): DuelCardData[] {
  return [
    {
      code: ancientDragonCode,
      name: "Ancient Dragon",
      kind: "monster",
      typeFlags: typeMonster | typeEffect,
      race: raceDragon,
      attribute: attributeLight,
      level: 4,
      attack: 1400,
      defense: 1300,
    },
  ];
}

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

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
