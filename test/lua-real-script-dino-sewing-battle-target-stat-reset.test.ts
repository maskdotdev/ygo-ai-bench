import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dinoCode = "27143874";
const attackerCode = "271438740";
const defenderCode = "271438741";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDinoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dinoCode}.lua`));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasDinoScript)("Lua real script Dino-Sewing battle target stat reset", () => {
  it("restores battle-target ATK/DEF gain, battle indestructibility, and battled ResetEffect cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dinoCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EVENT_BE_BATTLE_TARGET)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EVENT_BATTLED)");
    expect(script).toContain("return Duel.GetAttacker()==e:GetHandler()");
    expect(script).toContain("e:GetHandler():ResetEffect(RESET_DISABLE,RESET_EVENT)");

    const cards: DuelCardData[] = [
      { code: dinoCode, name: "Dino-Sewing", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Dino-Sewing First Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2500, defense: 1000 },
      { code: defenderCode, name: "Dino-Sewing Cleanup Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 27143874, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dinoCode] }, 1: { main: [attackerCode, defenderCode] } });
    startDuel(session);

    const dino = requireCard(session, dinoCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, dino, 0);
    moveFaceUpAttack(session, attacker, 1);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dinoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === dino.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: 42, event: "continuous", triggerEvent: undefined, value: 1 },
      { code: 1131, event: "trigger", triggerEvent: "battleTargeted", value: undefined },
      { code: 1138, event: "trigger", triggerEvent: "afterDamageCalculation", value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const firstAttack = getLuaRestoreLegalActions(restoredOpen, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === dino.uid
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, firstAttack!);
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-2-1131",
        eventCardUid: dino.uid,
        eventName: "battleTargeted",
        sourceUid: dino.uid,
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredTargeted = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTargeted);
    expectRestoredLegalActions(restoredTargeted, 0);
    const targetTrigger = getLuaRestoreLegalActions(restoredTargeted, 0).find((action) => action.type === "activateTrigger" && action.uid === dino.uid);
    expect(targetTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTargeted, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTargeted, targetTrigger!);
    resolveRestoredChain(restoredTargeted);
    expect(currentAttack(restoredTargeted.session.state.cards.find((card) => card.uid === dino.uid), restoredTargeted.session.state)).toBe(2000);
    expect(currentDefense(restoredTargeted.session.state.cards.find((card) => card.uid === dino.uid), restoredTargeted.session.state)).toBe(2000);
    expect(restoredTargeted.session.state.effects.filter((effect) => effect.sourceUid === dino.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33492992 }, value: 1000 },
      { code: 104, reset: { flags: 33492992 }, value: 1000 },
    ]);

    const restoredProtected = restoreDuelWithLuaScripts(serializeDuel(restoredTargeted.session), workspace, reader);
    expectCleanRestore(restoredProtected);
    finishBattle(restoredProtected);
    expect(restoredProtected.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
    expect(restoredProtected.session.state.cards.find((card) => card.uid === dino.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredProtected.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 1 });

    const restoredCleanup = restoreDuelWithLuaScripts(serializeDuel(restoredProtected.session), workspace, reader);
    expectCleanRestore(restoredCleanup);
    restoredCleanup.session.state.phase = "battle";
    restoredCleanup.session.state.turnPlayer = 0;
    restoredCleanup.session.state.waitingFor = 0;
    const cleanupAttack = getLuaRestoreLegalActions(restoredCleanup, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === dino.uid && action.targetUid === defender.uid
    );
    expect(cleanupAttack, JSON.stringify(getLuaRestoreLegalActions(restoredCleanup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCleanup, cleanupAttack!);
    finishBattle(restoredCleanup);
    expect(restoredCleanup.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
    expect(currentAttack(restoredCleanup.session.state.cards.find((card) => card.uid === dino.uid), restoredCleanup.session.state)).toBe(1000);
    expect(currentDefense(restoredCleanup.session.state.cards.find((card) => card.uid === dino.uid), restoredCleanup.session.state)).toBe(1000);
    expect(restoredCleanup.session.state.effects.filter((effect) => effect.sourceUid === dino.uid && [100, 104].includes(effect.code ?? -1))).toEqual([]);
    expect(restoredCleanup.session.state.cards.find((card) => card.uid === dino.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredCleanup.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
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

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
