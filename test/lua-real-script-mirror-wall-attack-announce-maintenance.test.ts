import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mirrorWallCode = "22359980";
const attackerCode = "223599800";
const defenderCode = "223599801";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMirrorWallScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mirrorWallCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const effectSetAttackFinal = 102;
const eventAttackAnnounce = 1130;
const eventStandby = 0x1002;

describe.skipIf(!hasUpstreamScripts || !hasMirrorWallScript)("Lua real script Mirror Wall attack announce maintenance", () => {
  it("restores tracked attacking monsters, final ATK halving, and Standby LP upkeep", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mirrorWallCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      { code: mirrorWallCode, name: "Mirror Wall", kind: "trap", typeFlags: typeTrap | typeContinuous },
      { code: attackerCode, name: "Mirror Wall Attacker", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1800, defense: 1000 },
      { code: defenderCode, name: "Mirror Wall Defender", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = { readScript(name: string) { return workspace.readScript(name); } };
    const session = createDuel({ seed: 22359980, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mirrorWallCode, defenderCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const mirrorWall = requireCard(session, mirrorWallCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, mirrorWall.uid, "spellTrapZone", 0);
    mirrorWall.faceUp = true;
    mirrorWall.position = "faceUpAttack";
    moveFaceUpAttack(session, attacker, 1);
    moveFaceUpAttack(session, defender, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mirrorWallCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === mirrorWall.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      labelObjectUids: effect.labelObjectUids,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 1002, event: "quick", labelObjectUids: undefined, range: ["spellTrapZone"], targetRange: undefined },
      { code: eventAttackAnnounce, event: "continuous", labelObjectUids: undefined, range: ["spellTrapZone"], targetRange: undefined },
      { code: effectSetAttackFinal, event: "continuous", labelObjectUids: undefined, range: ["spellTrapZone"], targetRange: [0, 4] },
      { code: eventStandby, event: "continuous", labelObjectUids: undefined, range: ["spellTrapZone"], targetRange: undefined },
    ]);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.eventHistory.filter((event) => event.eventName === "attackDeclared").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventReasonPlayer: 1 },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, restoredTrigger.session.state.waitingFor ?? 1);

    expect(restoredTrigger.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === attacker.uid && flag.code === Number(mirrorWallCode))).toEqual([
      { ownerType: "card", ownerId: attacker.uid, code: Number(mirrorWallCode), reset: 0x1fe1000, resetCount: 1, property: 0, value: 0, turn: 1 },
    ]);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === mirrorWall.uid && [eventAttackAnnounce, effectSetAttackFinal].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      labelObjectUids: effect.labelObjectUids,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: eventAttackAnnounce, event: "continuous", labelObjectUids: [attacker.uid], range: ["spellTrapZone"], targetRange: undefined },
      { code: effectSetAttackFinal, event: "continuous", labelObjectUids: [attacker.uid], range: ["spellTrapZone"], targetRange: [0, 4] },
    ]);
    const restoredAttack = restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid);
    expect(currentAttack(restoredAttack, restoredTrigger.session.state)).toBe(900);

    const restoredHalved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredHalved);
    expectRestoredLegalActions(restoredHalved, restoredHalved.session.state.waitingFor ?? 1);
    finishRestoredBattle(restoredHalved);
    expect(restoredHalved.session.state.battleDamage).toEqual({ 0: 0, 1: 100 });
    expect(restoredHalved.session.state.players[1].lifePoints).toBe(7900);
    expect(restoredHalved.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: defender.uid,
        eventPlayer: 1,
        eventValue: 100,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: defender.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredUpkeep = restoreDuelWithLuaScripts(serializeDuel(restoredHalved.session), source, reader);
    expectCleanRestore(restoredUpkeep);
    restoredUpkeep.session.state.phase = "draw";
    restoredUpkeep.session.state.turnPlayer = 0;
    restoredUpkeep.session.state.waitingFor = 0;
    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredUpkeep.session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);

    expect(restoredDraw.session.state.phase).toBe("standby");
    expect(restoredDraw.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredDraw.session.state.cards.find((card) => card.uid === mirrorWall.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredDraw.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 2000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: mirrorWall.uid,
        eventReasonEffectId: 4,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mirror Wall");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e:GetLabelObject():AddCard(a)");
  expect(script).toContain("a:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("return c:GetFlagEffect(id)~=0 and e:GetLabelObject():IsContains(c)");
  expect(script).toContain("return c:GetAttack()/2");
  expect(script).toContain("e4:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.CheckLPCost(tp,2000)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("Duel.PayLPCost(tp,2000)");
  expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_COST)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.pendingTriggers.length > 0) {
      const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
      const trigger = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "activateTrigger");
      expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restored, trigger!);
      continue;
    }
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passNextRestoredBattleStep(restored);
  }
}

function passNextRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
