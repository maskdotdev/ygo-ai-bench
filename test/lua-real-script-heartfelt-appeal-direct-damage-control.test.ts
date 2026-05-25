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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const appealCode = "32065885";
const attackerCode = "320658850";
const lowDefenseCode = "320658851";
const highDefenseCode = "320658852";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Heartfelt Appeal direct damage control", () => {
  it("restores direct battle-damage trigger into highest-DEF control, disable, and attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${appealCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("return ep==tp and Duel.GetAttackTarget()==nil and Duel.GetAttacker():IsControler(1-tp)");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter1,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("local sg=g:GetMaxGroup(Card.GetDefense)");
    expect(script).toContain("Duel.HintSelection(sg)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,2)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_ATTACK)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === appealCode),
      { code: attackerCode, name: "Heartfelt Appeal Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
      { code: lowDefenseCode, name: "Heartfelt Appeal Low DEF", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 500 },
      { code: highDefenseCode, name: "Heartfelt Appeal High DEF", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 2400 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 32065885, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [appealCode] }, 1: { main: [attackerCode, lowDefenseCode, highDefenseCode] } });
    startDuel(session);

    const appeal = requireCard(session, appealCode);
    const attacker = requireCard(session, attackerCode);
    const lowDefense = requireCard(session, lowDefenseCode);
    const highDefense = requireCard(session, highDefenseCode);
    moveDuelCard(session.state, appeal.uid, "spellTrapZone", 0);
    appeal.faceUp = false;
    appeal.position = "faceDown";
    moveFaceUpAttack(session, attacker, 1, 0);
    moveFaceUpAttack(session, lowDefense, 1, 1);
    moveFaceUpAttack(session, highDefense, 1, 2);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(appealCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.directAttack);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    const activation = passBattleUntilActivation(restoredBattle, appeal.uid);
    expect(restoredBattle.session.state.players[0]!.lifePoints).toBe(6300);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 0,
        eventValue: 1700,
        eventReason: duelReason.battle,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(activation).toMatchObject({ type: "activateEffect", uid: appeal.uid, effectId: "lua-1-1143" });
    const restoredActivation = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateEffect" && action.uid === appeal.uid);
    expect(restoredActivation, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, restoredActivation!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === highDefense.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === lowDefense.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === appeal.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === highDefense.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: highDefense.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: appeal.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === highDefense.uid && [2, 8, 85].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
    }))).toEqual([
      { code: 2, event: "continuous", reset: { count: 2, flags: 1107038720 } },
      { code: 8, event: "continuous", reset: { count: 2, flags: 1107038720 } },
      { code: 85, event: "continuous", reset: { count: 2, flags: 1107038720 } },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function passBattleUntilActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): DuelAction {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const activation = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateEffect" && action.uid === uid);
    if (activation && restored.session.state.eventHistory.some((event) => event.eventName === "battleDamageDealt")) return activation;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
  for (const player of [0, 1] as const) {
    const activation = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateEffect" && action.uid === uid);
    if (activation) return activation;
  }
  throw new Error(`No activation found for ${uid}`);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
