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
const vortexCode = "97182396";
const equippedMonsterCode = "971823960";
const attackerCode = "971823961";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVortexScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vortexCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceMachine = 0x2000;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const categoryToHand = 0x8;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const eventChaining = 1027;
const eventAttackAnnounce = 1130;

describe.skipIf(!hasUpstreamScripts || !hasVortexScript)("Lua real script Amaze Attraction Viking Vortex attack control", () => {
  it("restores Attraction equip metadata and attack-announce negate into temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${vortexCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 97182396, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vortexCode, equippedMonsterCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const vortex = requireCard(session, vortexCode);
    const equippedMonster = requireCard(session, equippedMonsterCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpSpellTrap(session, vortex, 0);
    moveFaceUpAttack(session, equippedMonster, 0, 0);
    moveFaceUpAttack(session, attacker, 1, 0);
    vortex.equippedToUid = equippedMonster.uid;
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vortexCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === vortex.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x40000, code: eventFreeChain, countLimit: undefined, event: "quick", id: `lua-1-${eventFreeChain}`, property: 0x10, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventAttackAnnounce, countLimit: 1, event: "trigger", id: `lua-2-${eventAttackAnnounce}`, property: undefined, range: ["spellTrapZone"], triggerEvent: "attackDeclared" },
      { category: categoryToHand, code: eventChaining, countLimit: undefined, event: "quick", id: `lua-3-${eventChaining}`, property: undefined, range: ["spellTrapZone"], triggerEvent: "chaining" },
    ]);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === equippedMonster.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const trigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === vortex.uid && action.effectId === `lua-2-${eventAttackAnnounce}`
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, trigger!);
    resolveRestoredChain(restoredBattle);

    expect(findCard(restoredBattle.session, equippedMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: vortex.uid,
      reasonEffectId: 2,
    });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "controlChanged").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "controlChanged", eventCardUid: equippedMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: vortex.uid, eventReasonEffectId: 2, previousController: 0, currentController: 1 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: vortexCode, name: "Amaze Attraction Viking Vortex", kind: "trap", typeFlags: typeTrap },
    { code: equippedMonsterCode, name: "Viking Vortex Equipped Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
    { code: attackerCode, name: "Viking Vortex Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Amaze Attraction Viking Vortex");
  expect(script).toContain("aux.AddAttractionEquipProc(c)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCondition(aux.AttractionEquipCon(true))");
  expect(script).toContain("Duel.GetAttacker()");
  expect(script).toContain("Duel.NegateAttack()");
  expect(script).toContain("Duel.GetControl(ec,1-ec:GetControler(),PHASE_BATTLE,1)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e2:SetCondition(aux.AttractionEquipCon(false))");
  expect(script).toContain("Duel.SendtoHand(ec,nil,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", controller);
  moved.faceUp = true;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
