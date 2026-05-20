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
const saizanCode = "70271583";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSaizanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${saizanCode}.lua`));
const allyCode = "702715830";
const attackerCode = "702715831";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setKarakuri = 0x11;

describe.skipIf(!hasUpstreamScripts || !hasSaizanScript)("Lua real script Karakuri Saizan battle position stat", () => {
  it("restores battle-target defense change and battle-damage Karakuri group stat boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${saizanCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_MUST_ATTACK)");
    expect(script).toContain("e3:SetCode(EVENT_BE_BATTLE_TARGET)");
    expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE,0,POS_FACEUP_ATTACK,0)");
    expect(script).toContain("e4:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e5:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");

    const cards: DuelCardData[] = [
      { code: saizanCode, name: "Karakuri Watchdog mdl 313 Saizan", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 600, defense: 1800 },
      { code: allyCode, name: "Karakuri Saizan Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 1500, defense: 1200 },
      { code: attackerCode, name: "Saizan Battle Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 70271583, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [saizanCode, allyCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const saizan = requireCard(session, saizanCode);
    const ally = requireCard(session, allyCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, saizan, 0);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, attacker, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(saizanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === saizan.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 191, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
      { code: 1131, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "battleTargeted" },
      { code: 1143, event: "trigger", range: ["monsterZone"], triggerEvent: "battleDamageDealt" },
      { code: 42, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
    ]);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 1);
    const attack = getLuaRestoreLegalActions(restoredSetup, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === saizan.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSetup, attack!);
    expect(restoredSetup.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-2-1131",
        eventCardUid: saizan.uid,
        eventName: "battleTargeted",
        sourceUid: saizan.uid,
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredTargetTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expectCleanRestore(restoredTargetTrigger);
    expectRestoredLegalActions(restoredTargetTrigger, 0);
    const positionTrigger = getLuaRestoreLegalActions(restoredTargetTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === saizan.uid);
    expect(positionTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTargetTrigger, 0), null, 2)).toBeDefined();
    expect(positionTrigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredTargetTrigger, positionTrigger!);
    resolveRestoredChain(restoredTargetTrigger);
    expect(restoredTargetTrigger.session.state.cards.find((card) => card.uid === saizan.uid)).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(restoredTargetTrigger.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === saizan.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: saizan.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: saizan.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);

    const restoredDamageSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDamageSetup);
    restoredDamageSetup.session.state.turnPlayer = 0;
    restoredDamageSetup.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredDamageSetup, 0);
    const saizanAttack = getLuaRestoreLegalActions(restoredDamageSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === saizan.uid && action.targetUid === attacker.uid,
    );
    expect(saizanAttack, JSON.stringify(getLuaRestoreLegalActions(restoredDamageSetup, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDamageSetup, saizanAttack!);
    passBattleUntilTrigger(restoredDamageSetup);
    expect(restoredDamageSetup.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-3-1143",
        eventCardUid: attacker.uid,
        eventName: "battleDamageDealt",
        eventPlayer: 0,
        eventValue: 1800,
        sourceUid: saizan.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDamageSetup.session), workspace, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === saizan.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    expect(statTrigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredDamageTrigger, statTrigger!);
    resolveRestoredChain(restoredDamageTrigger);
    expect(currentAttack(restoredDamageTrigger.session.state.cards.find((card) => card.uid === saizan.uid), restoredDamageTrigger.session.state)).toBe(1400);
    expect(currentDefense(restoredDamageTrigger.session.state.cards.find((card) => card.uid === saizan.uid), restoredDamageTrigger.session.state)).toBe(2600);
    expect(currentAttack(restoredDamageTrigger.session.state.cards.find((card) => card.uid === ally.uid), restoredDamageTrigger.session.state)).toBe(2300);
    expect(currentDefense(restoredDamageTrigger.session.state.cards.find((card) => card.uid === ally.uid), restoredDamageTrigger.session.state)).toBe(2000);
    expect(restoredDamageTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 0,
        eventValue: 1800,
        eventReason: duelReason.battle,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
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

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
