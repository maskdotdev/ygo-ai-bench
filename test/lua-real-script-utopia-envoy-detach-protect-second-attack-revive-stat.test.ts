import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const utopiaCode = "76504386";
const materialACode = "765043860";
const materialBCode = "765043861";
const allyCode = "765043862";
const firstTargetCode = "765043863";
const reviveTargetCode = "765043864";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUtopiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${utopiaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setNumber = 0x48;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectIndestructableCount = 47;
const eventAttackAnnounce = 1130;
const eventBattleDestroying = 1139;

describe.skipIf(!hasUpstreamScripts || !hasUtopiaScript)("Lua real script Utopia Envoy detach protect second attack revive stat", () => {
  it("restores detach protection, attack-count ATK gain, and battle-destroy revive trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${utopiaCode}.lua`));
    const reader = createCardReader(cards());

    const restoredProtect = createRestoredField({ reader, workspace });
    expectCleanRestore(restoredProtect);
    expectRestoredLegalActions(restoredProtect, 0);
    const protectUtopia = requireCard(restoredProtect.session, utopiaCode);
    const materialA = requireCard(restoredProtect.session, materialACode);
    const ally = requireCard(restoredProtect.session, allyCode);
    const protect = getLuaRestoreLegalActions(restoredProtect, 0).find((action) => action.type === "activateEffect" && action.uid === protectUtopia.uid && action.effectId === "lua-3-1002");
    expect(protect, JSON.stringify(getLuaRestoreLegalActions(restoredProtect, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProtect, protect!);
    resolveRestoredChain(restoredProtect);

    expect(restoredProtect.session.state.cards.find((card) => card.uid === protectUtopia.uid)?.overlayUids).toEqual([requireCard(restoredProtect.session, materialBCode).uid]);
    expect(restoredProtect.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: protectUtopia.uid,
      reasonEffectId: 3,
    });
    expect(restoredProtect.session.state.effects.filter((effect) => effect.sourceUid === protectUtopia.uid && effect.code === effectIndestructableCount).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableCount, countLimit: 1, description: 3001, property: 0x4000100, reset: { flags: 1107169792 }, sourceUid: protectUtopia.uid, value: undefined },
    ]);

    const restoredBattle = createRestoredField({ reader, workspace });
    expectCleanRestore(restoredBattle);
    const battleUtopia = requireCard(restoredBattle.session, utopiaCode);
    const firstTarget = requireCard(restoredBattle.session, firstTargetCode);
    const reviveTarget = requireCard(restoredBattle.session, reviveTargetCode);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const firstAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ally.uid && action.targetUid === firstTarget.uid);
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, firstAttack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1130", eventCardUid: ally.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventTriggerTiming: "when", player: 0, sourceUid: battleUtopia.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const attackBoost = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleUtopia.uid && action.effectId === "lua-4-1130");
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, attackBoost!);
    resolveRestoredChain(restoredAttackTrigger);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === battleUtopia.uid), restoredAttackTrigger.session.state)).toBe(5000);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleUtopia.uid && effect.code === eventBattleDestroying).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([{ code: eventBattleDestroying, event: "trigger", reset: { flags: 33427456 }, sourceUid: battleUtopia.uid, triggerEvent: "battleDestroyed" }]);
    finishBattleUntilOpen(restoredAttackTrigger);

    const restoredSecondOpen = restoreDuelWithLuaScripts(serializeDuel(restoredAttackTrigger.session), workspace, reader);
    expectCleanRestore(restoredSecondOpen);
    expectRestoredLegalActions(restoredSecondOpen, 0);
    const secondAttack = getLuaRestoreLegalActions(restoredSecondOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === battleUtopia.uid && action.targetUid === reviveTarget.uid);
    expect(secondAttack, JSON.stringify(getLuaRestoreLegalActions(restoredSecondOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSecondOpen, secondAttack!);
    finishBattleUntilTrigger(restoredSecondOpen);

    const restoredReviveTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSecondOpen.session), workspace, reader);
    expectCleanRestore(restoredReviveTrigger);
    expectRestoredLegalActions(restoredReviveTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredReviveTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleUtopia.uid && action.effectId === "lua-6-1139");
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredReviveTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReviveTrigger, revive!);
    resolveRestoredChain(restoredReviveTrigger);
    expect(restoredReviveTrigger.session.state.cards.find((card) => card.uid === reviveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: battleUtopia.uid,
      reasonEffectId: 6,
    });
    const relevantEvents = restoredReviveTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "battleDestroyed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }));
    expect(relevantEvents).toEqual([
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: firstTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ally.uid, eventReasonEffectId: undefined },
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: battleUtopia.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: reviveTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: battleUtopia.uid, eventReasonEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: battleUtopia.uid, eventReasonEffectId: 6 },
    ]);
    expect(restoredReviveTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 3900 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number 39: Utopia the Envoy of Light");
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,2)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
  expect(script).toContain("return Duel.GetFlagEffect(0,id)==1");
  expect(script).toContain("Duel.RegisterFlagEffect(0,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("c:UpdateAttack(2500)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("Duel.SetTargetCard(bc)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: utopiaCode, name: "Number 39: Utopia the Envoy of Light", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setNumber], race: raceWarrior, attribute: attributeLight, level: 4, attack: 2500, defense: 2000 },
    { code: materialACode, name: "Utopia Envoy Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Utopia Envoy Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: allyCode, name: "Utopia Envoy First Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: firstTargetCode, name: "Utopia Envoy First Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: reviveTargetCode, name: "Utopia Envoy Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1100, defense: 1000 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 76504386, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialACode, materialBCode, allyCode], extra: [utopiaCode] }, 1: { main: [firstTargetCode, reviveTargetCode] } });
  startDuel(session);
  const utopia = requireCard(session, utopiaCode);
  moveFaceUpAttack(session, utopia, 0, 0);
  utopia.summonType = "xyz";
  utopia.customStatusMask = 0x8;
  attachOverlay(session, utopia, requireCard(session, materialACode), 0);
  attachOverlay(session, utopia, requireCard(session, materialBCode), 1);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, firstTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, reviveTargetCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(utopiaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
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

function attachOverlay(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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

function finishBattleUntilOpen(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
