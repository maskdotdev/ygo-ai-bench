import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const powerWallCode = "76403456";
const hasPowerWallScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${powerWallCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPowerWallScript)("Lua real script Power Wall pre-damage deck mill prevention", () => {
  it("restores pre-damage battle damage lookup, Deck discard, operated group, and damage prevention", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "76403457";
    const targetCode = "76403458";
    const millCodes = ["76403459", "76403460", "76403461"];
    const script = workspace.readScript(`c${powerWallCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("math.ceil(Duel.GetBattleDamage(tp)/500)");
    expect(script).toContain("Duel.DiscardDeck(tp,val,REASON_EFFECT)");
    expect(script).toContain("Duel.GetOperatedGroup()");
    expect(script).toContain("EFFECT_AVOID_BATTLE_DAMAGE");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === powerWallCode),
      { code: attackerCode, name: "Power Wall Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2500, defense: 1000 },
      { code: targetCode, name: "Power Wall Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...millCodes.map((code, index) => ({ code, name: `Power Wall Mill ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 76403456, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [powerWallCode, targetCode, ...millCodes] } });
    startDuel(session);

    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    const powerWall = requireCard(session, powerWallCode);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, powerWall.uid, "spellTrapZone", 1);
    powerWall.position = "faceDown";
    powerWall.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(powerWallCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 1, "passAttack");
    passBattleAction(session, 0, "passAttack");
    passBattleAction(session, 1, "passDamage");
    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    passBattleAction(session, 0, "passDamage");
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(session.state.waitingFor).toBe(1);
    expect(session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: attacker.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventUids: [attacker.uid, target.uid],
      },
    ]);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 1);
    const activation = getLuaRestoreLegalActions(restoredPreDamage, 1).find((action) => action.type === "activateEffect" && action.uid === powerWall.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPreDamage, activation!);
    const sentToGraveyardEvents = restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && millCodes.includes(restoredPreDamage.session.state.cards.find((card) => card.uid === event.eventCardUid)?.code ?? ""));
    expect(new Set(sentToGraveyardEvents.map((event) => event.eventCardUid))).toEqual(new Set(millCodes.map((code) => requireCard(restoredPreDamage.session, code).uid)));
    expect(sentToGraveyardEvents.every((event) => event.eventReason === duelReason.effect)).toBe(true);
    expect(sentToGraveyardEvents.every((event) => event.eventReasonCardUid === powerWall.uid)).toBe(true);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "discarded" && event.eventReasonCardUid === powerWall.uid)).toEqual([
      expect.objectContaining({ eventCode: 1018, eventReason: duelReason.effect, eventReasonPlayer: 1, eventUids: expect.arrayContaining(millCodes.map((code) => requireCard(restoredPreDamage.session, code).uid)) }),
    ]);
    for (const code of millCodes) expect(restoredPreDamage.session.state.cards.find((card) => card.code === code)).toMatchObject({ location: "graveyard", controller: 1 });

    const restoredDamagePrevention = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredDamagePrevention);
    expectRestoredLegalActions(restoredDamagePrevention, 0);
    passRestoredBattle(restoredDamagePrevention);
    expect(restoredDamagePrevention.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredDamagePrevention.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredDamagePrevention.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker.uid,
      reasonPlayer: 0,
    });
    expect(restoredDamagePrevention.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([]);
    expect(restoredDamagePrevention.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([]);
  });
});

function passBattleAction(session: DuelSession, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLegalActions(session, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    if (restored.session.state.chain.length > 0) {
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restored, pass!);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
