import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const slateCode = "78636495";
const attackerCode = "786364950";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSlateScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${slateCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSlateScript)("Lua real script Slate Warrior battle destroyed stat", () => {
  it("restores battle-destroyed surviving opponent ATK/DEF loss from GetAttacker/GetAttackTarget", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${slateCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("local tc=Duel.GetAttacker()");
    expect(script).toContain("if c==tc then tc=Duel.GetAttackTarget() end");
    expect(script).toContain("if not tc:IsRelateToBattle() then return end");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-500)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: slateCode, name: "Slate Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 400 },
      { code: attackerCode, name: "Slate Warrior Battle Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 78636495, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [slateCode] }, 1: { main: [attackerCode] } });
    startDuel(session);
    const slate = requireCard(session, slateCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, slate.uid, "monsterZone", 0).position = "faceUpAttack";
    slate.faceUp = true;
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
    attacker.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(slateCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === slate.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);

    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === slate.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: attacker.uid,
    });
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        player: 0,
        effectId: "lua-2-1140",
        sourceUid: slate.uid,
        triggerBucket: "opponentMandatory",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: slate.uid,
        eventPlayer: 0,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === slate.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid), restoredTrigger.session.state)).toBe(1900);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid), restoredTrigger.session.state)).toBe(1100);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, value: -500 },
      { code: 104, reset: { flags: 33427456 }, value: -500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: slate.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
