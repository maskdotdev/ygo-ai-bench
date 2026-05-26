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
const peacockCode = "20265095";
const fireFormationCode = "202650950";
const linkedFireFistCode = "202650951";
const controlTargetCode = "202650952";
const defenderCode = "202650953";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPeacockScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${peacockCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const setFireFist = 0x79;
const setFireFormation = 0x7c;
const categoryControl = 0x2000;
const eventAttackAnnounce = 1130;
const effectCannotBeBattleTarget = 70;
const effectCannotAttack = 85;
const effectFlagCardTarget = 0x10;
const effectFlagSingleRange = 0x20000;
const effectFlagClientHint = 0x4000000;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasPeacockScript)("Lua real script Fire Fist Peacock attack control", () => {
  it("restores attack-announce Fire Formation cost into linked-zone temporary control and attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectPeacockScriptShape(workspace.readScript(`official/c${peacockCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 20265095, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fireFormationCode, linkedFireFistCode], extra: [peacockCode] }, 1: { main: [controlTargetCode, defenderCode] } });
    startDuel(session);

    const peacock = requireCard(session, peacockCode);
    const formation = requireCard(session, fireFormationCode);
    const linkedFireFist = requireCard(session, linkedFireFistCode);
    const controlTarget = requireCard(session, controlTargetCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, peacock, 0, 2);
    peacock.summonType = "link";
    peacock.summonPlayer = 0;
    moveFaceUpAttack(session, linkedFireFist, 0, 1);
    moveFaceUpSpellTrap(session, formation, 0, 0);
    moveFaceUpAttack(session, controlTarget, 1, 0);
    moveFaceUpAttack(session, defender, 1, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(peacockCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const restoredPeacock = requireCard(restoredOpen.session, peacockCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === restoredPeacock.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: effectCannotBeBattleTarget, event: "continuous", id: "lua-2-70", property: effectFlagSingleRange, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventAttackAnnounce, event: "trigger", id: `lua-3-${eventAttackAnnounce}`, property: effectFlagCardTarget, range: allLocations, triggerEvent: "attackDeclared" },
    ]);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === peacock.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: `lua-3-${eventAttackAnnounce}`, eventCardUid: peacock.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventReason: 0, eventReasonPlayer: 0, player: 0, sourceUid: peacock.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const activate = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === peacock.uid && action.effectId === `lua-3-${eventAttackAnnounce}`);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, activate!);
    resolveRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, formation.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: peacock.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restoredTrigger.session, controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      sequence: 3,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: peacock.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectCannotAttack && effect.sourceUid === controlTarget.uid).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectCannotAttack, description: 3206, event: "continuous", property: effectFlagClientHint, reset: { flags: 1107038720 }, sourceUid: controlTarget.uid },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "sentToGraveyard", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: peacock.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: formation.uid, eventReason: duelReason.cost, eventReasonCardUid: peacock.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: controlTarget.uid, eventReason: duelReason.effect, eventReasonCardUid: peacock.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(getLuaRestoreLegalActions(restoredTrigger, 0).some((action) => action.type === "declareAttack" && action.attackerUid === controlTarget.uid)).toBe(false);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === peacockCode).map((card) => ({ ...card, linkMarkers: 0x28 })),
    { code: fireFormationCode, name: "Peacock Fire Formation Cost", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setFireFormation] },
    { code: linkedFireFistCode, name: "Peacock Linked Fire Fist", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setFireFist], race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1700, defense: 1000 },
    { code: controlTargetCode, name: "Peacock Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
    { code: defenderCode, name: "Peacock Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
  ];
}

function expectPeacockScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Brotherhood of the Fire Fist - Peacock");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_FIRE_FIST),2,2)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("e1:SetValue(aux.imval1)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e2:SetCost(Cost.Replaceable(s.ctcost,s.extracon))");
  expect(script).toContain("Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL,zones)>0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.ctcostfilter,tp,LOCATION_ONFIELD,0,1,1,nil,tp,zones)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE,tp,LOCATION_REASON_CONTROL,zones)>0");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1,zone)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
