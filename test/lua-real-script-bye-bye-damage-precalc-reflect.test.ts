import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const byeByeCode = "20735371";
const attackerCode = "207353710";
const defenderCode = "207353711";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeNormal = 0x10;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectIndestructibleBattle = 42;
const eventBattleDamage = 1143;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Bye Bye Damage pre-calc reflect", () => {
  it("restores attack-target battle indestructibility and battle-damage double reflect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${byeByeCode}.lua`));
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === byeByeCode),
      { code: attackerCode, name: "Bye Bye Attacker", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
      { code: defenderCode, name: "Bye Bye Defender", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 20735371, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [byeByeCode, defenderCode] } });
    startDuel(session);
    const trap = requireCard(session, byeByeCode);
    const defender = requireCard(session, defenderCode);
    const attacker = requireCard(session, attackerCode);
    const setTrap = moveDuelCard(session.state, trap.uid, "spellTrapZone", 1);
    setTrap.position = "faceDown";
    setTrap.faceUp = false;
    moveFaceUpAttack(session, defender, 1, 0);
    moveFaceUpAttack(session, attacker, 0, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(byeByeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passRestoredBattleStep(restoredOpen, 1, "passAttack");
    passRestoredBattleStep(restoredOpen, 0, "passAttack");
    passRestoredBattleStep(restoredOpen, 1, "passDamage");
    passRestoredBattleStep(restoredOpen, 0, "passDamage");
    expect(restoredOpen.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restoredOpen.session.state.waitingFor).toBe(1);
    expect(getLuaRestoreLegalActions(restoredOpen, 1), JSON.stringify({
      trapUid: trap.uid,
      currentAttack: restoredOpen.session.state.currentAttack,
      pendingBattle: restoredOpen.session.state.pendingBattle,
      effects: restoredOpen.session.state.effects.filter((effect) => effect.code === 1134),
      actions: getLuaRestoreLegalActions(restoredOpen, 1),
    }, null, 2)).toContainEqual(expect.objectContaining({ type: "activateEffect", uid: trap.uid }));

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    const activation = getLuaRestoreLegalActions(restoredPreDamage, 1).find((action) => action.type === "activateEffect" && action.uid === trap.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, activation!);
    resolveRestoredChain(restoredPreDamage);

    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === trap.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.rule,
      reasonPlayer: 1,
    });
    expect(restoredPreDamage.session.state.flagEffects.filter((flag) => flag.ownerType === "player" && flag.ownerId === "1" && flag.code === Number(byeByeCode))).toEqual([
      { ownerType: "player", ownerId: "1", code: Number(byeByeCode), reset: 0x40000200, resetCount: 1, property: 0, value: 0, turn: 1 },
    ]);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectIndestructibleBattle).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleBattle, event: "continuous", sourceUid: defender.uid, value: 1 },
    ]);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === eventBattleDamage).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: eventBattleDamage, event: "continuous", range: ["monsterZone"], sourceUid: defender.uid },
    ]);

    const restoredReflect = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredReflect);
    expect(restoredReflect.session.state.effects.filter((effect) => effect.code === eventBattleDamage).map((effect) => ({
      canActivate: typeof effect.canActivate,
      event: effect.event,
      operation: typeof effect.operation,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([{ canActivate: "function", event: "trigger", operation: "function", sourceUid: defender.uid, triggerEvent: "battleDamageDealt" }]);
    finishRestoredBattle(restoredReflect);

    expect(restoredReflect.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restoredReflect.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
    expect(restoredReflect.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredReflect.session.state.players[0].lifePoints).toBe(6400);
    expect(restoredReflect.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: eventBattleDamage,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: attacker.uid,
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
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Bye Bye Damage");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("local t=Duel.GetAttackTarget()");
  expect(script).toContain("Duel.GetFlagEffect(tp,id)==0");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("eg:GetFirst():IsRelateToBattle()");
  expect(script).toContain("Duel.Damage(1-tp,ev*2,REASON_EFFECT)");
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

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, passType: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  const response = applyLuaRestoreResponse(restored, pass!);
  expect(response.ok, response.error).toBe(true);
}

function passNextRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  passRestoredBattleStep(restored, player, passType);
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

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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
