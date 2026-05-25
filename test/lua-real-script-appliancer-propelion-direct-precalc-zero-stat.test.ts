import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const propelionCode = "81769387";
const attackerCode = "817693871";
const targetCode = "817693870";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPropelionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${propelionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const setAppliancer = 0x14a;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasPropelionScript)("Lua real script Appliancer Propelion direct precalc zero stat", () => {
  it("restores direct attack permission and co-linked pre-damage opponent ATK zeroing", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${propelionCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 81769387, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [propelionCode, attackerCode] }, 1: { main: [targetCode] } });
    startDuel(session);
    const propelion = requireCard(session, propelionCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, propelion, 0, 1);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(propelionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(getLuaRestoreLegalActions(restoredBattle, 0).some((action) => action.type === "declareAttack" && action.attackerUid === propelion.uid && action.targetUid === undefined)).toBe(true);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === propelion.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 31, event: "continuous", sourceUid: propelion.uid, triggerEvent: undefined },
      { code: 239, event: "continuous", sourceUid: propelion.uid, triggerEvent: undefined },
      { code: 74, event: "continuous", sourceUid: propelion.uid, triggerEvent: undefined },
      { code: 1134, event: "trigger", sourceUid: propelion.uid, triggerEvent: "beforeDamageCalculation" },
      { code: 1134, event: "trigger", sourceUid: propelion.uid, triggerEvent: "beforeDamageCalculation" },
    ]);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passUntilBattleWindow(restoredBattle, "beforeDamageCalculation");
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    passDamageIfAvailable(restoredPreDamage, 1);
    passDamageIfAvailable(restoredPreDamage, 0);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === propelion.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === propelion.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetCardUids: effect.targetCardUids,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 64 }, sourceUid: propelion.uid, targetCardUids: [target.uid], value: 0 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: attacker.uid,
        eventUids: [attacker.uid, target.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: propelionCode, name: "Appliancer Propelion", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setAppliancer], level: 1, attack: 1200, defense: 0, linkMarkers: 0x28 },
    { code: attackerCode, name: "Propelion Co-linked Attacker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setAppliancer], level: 1, attack: 1600, defense: 0, linkMarkers: 0x20 },
    { code: targetCode, name: "Propelion Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Appliancer Propelion");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_LINK_MATERIAL)");
  expect(script).toContain("e2:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e:GetHandler():GetMutualLinkedGroupCount()>0");
  expect(script).toContain("c:GetMutualLinkedGroupCount()==0");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE_CAL)");
  expect(script).toContain("e1:SetValue(0)");
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) =>
      candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, action!);
  }
}

function passDamageIfAvailable(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  if (restored.session.state.waitingFor !== player) return;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passDamage");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
