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
const cavalryCode = "2396042";
const pendulumTargetCode = "23960420";
const regularTargetCode = "23960421";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCavalryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cavalryCode}.lua`));
const typeMonster = 0x1;
const typePendulum = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasCavalryScript)("Lua real script Steel Cavalry battle-start final stat", () => {
  it("restores battle-start final ATK/DEF halving only against a face-up Pendulum battle target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cavalryCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("bc and bc:IsFaceup() and bc:IsType(TYPE_PENDULUM)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e1:SetValue(c:GetDefense()/2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetValue(c:GetAttack()/2)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE|RESET_PHASE|PHASE_DAMAGE)");

    const cards: DuelCardData[] = [
      { code: cavalryCode, name: "Steel Cavalry of Dinon", kind: "monster", typeFlags: typeMonster | typePendulum, level: 4, attack: 1600, defense: 2600, leftScale: 5, rightScale: 5 },
      { code: pendulumTargetCode, name: "Steel Cavalry Pendulum Target", kind: "monster", typeFlags: typeMonster | typePendulum, level: 4, attack: 1200, defense: 1000, leftScale: 1, rightScale: 1 },
      { code: regularTargetCode, name: "Steel Cavalry Regular Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2396042, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cavalryCode] }, 1: { main: [pendulumTargetCode, regularTargetCode] } });
    startDuel(session);

    const cavalry = requireCard(session, cavalryCode);
    const pendulumTarget = requireCard(session, pendulumTargetCode);
    const regularTarget = requireCard(session, regularTargetCode);
    moveFaceUpAttack(session, cavalry, 0);
    moveFaceUpAttack(session, pendulumTarget, 1);
    moveFaceUpAttack(session, regularTarget, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cavalryCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredRegular = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredRegular);
    expectRestoredLegalActions(restoredRegular, 0);
    const regularAttack = getLuaRestoreLegalActions(restoredRegular, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === cavalry.uid && action.targetUid === regularTarget.uid
    );
    expect(regularAttack, JSON.stringify(getLuaRestoreLegalActions(restoredRegular, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRegular, regularAttack!);
    passUntilBattleStarted(restoredRegular);
    expect(restoredRegular.session.state.pendingTriggers).toEqual([]);
    finishBattle(restoredRegular);
    expect(restoredRegular.session.state.battleDamage).toEqual({ 0: 0, 1: 400 });
    expect(currentAttack(restoredRegular.session.state.cards.find((card) => card.uid === cavalry.uid), restoredRegular.session.state)).toBe(1600);
    expect(currentDefense(restoredRegular.session.state.cards.find((card) => card.uid === cavalry.uid), restoredRegular.session.state)).toBe(2600);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const pendulumAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === cavalry.uid && action.targetUid === pendulumTarget.uid
    );
    expect(pendulumAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, pendulumAttack!);
    passUntilBattleStarted(restoredOpen);
    expect(restoredOpen.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: cavalry.uid,
        eventName: "battleStarted",
        sourceUid: cavalry.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cavalry.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === cavalry.uid), restoredTrigger.session.state)).toBe(800);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === cavalry.uid), restoredTrigger.session.state)).toBe(1300);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === cavalry.uid && [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 106, reset: { flags: 1107234848 }, value: 1300 },
      { code: 102, reset: { flags: 1107234848 }, value: 800 },
    ]);

    const restoredHalved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredHalved);
    finishBattle(restoredHalved);
    expect(restoredHalved.session.state.battleDamage).toEqual({ 0: 400, 1: 0 });
    expect(restoredHalved.session.state.cards.find((card) => card.uid === cavalry.uid)).toMatchObject({ location: "extraDeck", controller: 0, faceUp: true });
    expect(restoredHalved.session.state.cards.find((card) => card.uid === pendulumTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
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

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== "startDamageStep") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
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
