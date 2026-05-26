import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const powerCode = "1118137";
const attackerCode = "11181370";
const defenderCode = "11181371";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPowerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${powerCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const counterSpell = 0x1;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasPowerScript)("Lua real script Power of the Guardians counter equip stat", () => {
  it("restores equipped Spell Counter ATK/DEF gain and attack-announcement counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${powerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredBattleState(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const power = requireCard(restoredOpen.session, powerCode);
    const attacker = requireCard(restoredOpen.session, attackerCode);
    const defender = requireCard(restoredOpen.session, defenderCode);
    expect(getDuelCardCounter(findCard(restoredOpen.session, power.uid), counterSpell)).toBe(1);
    expect(currentAttack(findCard(restoredOpen.session, attacker.uid), restoredOpen.session.state)).toBe(2000);
    expect(currentDefense(findCard(restoredOpen.session, attacker.uid), restoredOpen.session.state)).toBe(1700);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === power.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 0x10000 + counterSpell, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: 1002, event: "ignition", range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { code: 76, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: 1130, event: "trigger", range: ["spellTrapZone"], triggerEvent: "attackDeclared" },
      { code: effectUpdateAttack, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: effectUpdateDefense, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: 50, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === power.uid);
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, counterTrigger!);
    resolveRestoredChain(restoredTrigger);

    expect(getDuelCardCounter(findCard(restoredTrigger.session, power.uid), counterSpell)).toBe(2);
    expect(currentAttack(findCard(restoredTrigger.session, attacker.uid), restoredTrigger.session.state)).toBe(2500);
    expect(currentDefense(findCard(restoredTrigger.session, attacker.uid), restoredTrigger.session.state)).toBe(2200);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "attackDeclared", eventCardUid: attacker.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCardUid: power.uid, eventReason: duelReason.effect, eventReasonCardUid: power.uid, eventReasonEffectId: 4 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: powerCode, name: "Power of the Guardians", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: attackerCode, name: "Power Guardians Equipped Attacker", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
    { code: defenderCode, name: "Power Guardians Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredBattleState(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 1118137, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [powerCode, attackerCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const power = moveFaceUpEquip(session, requireCard(session, powerCode), 0, 0, requireCard(session, attackerCode).uid);
  expect(addDuelCardCounter(power, counterSpell, 1)).toBe(true);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerPower(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerPower(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(powerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Power of the Guardians");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("aux.AddEquipProcedure(c)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return Duel.GetAttacker()==tc or Duel.GetAttackTarget()==tc");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_SPELL)*500");
  expect(script).toContain("e5:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,1,REASON_EFFECT|REASON_REPLACE)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, equippedToUid: string): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
