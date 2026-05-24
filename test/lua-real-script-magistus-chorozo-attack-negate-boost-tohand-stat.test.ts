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
const chorozoCode = "66532962";
const attackerCode = "665329620";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasChorozoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chorozoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const eventAttackAnnounce = 1130;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasChorozoScript)("Lua real script Magistus Chorozo attack negate boost to-hand stat", () => {
  it("restores attack-announcement target, attack negation, ATK gain, and optional attacker return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${chorozoCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 66532962, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [chorozoCode] }, 1: { main: [attackerCode] } });
    startDuel(session);
    const chorozo = moveFaceUpAttack(session, requireCard(session, chorozoCode), 0, 0);
    const attacker = moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chorozoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === chorozo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 30, event: "continuous", id: "lua-2-30", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 34, event: "summonProcedure", id: "lua-3-34", property: 262144, range: ["extraDeck"], triggerEvent: undefined },
      { category: 0x200008, code: eventAttackAnnounce, event: "trigger", id: "lua-4-1130", property: 0x10, range: ["monsterZone"], triggerEvent: "attackDeclared" },
    ]);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === chorozo.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-4-1130", eventCardUid: attacker.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventReason: 0, eventReasonPlayer: 1, player: 0, sourceUid: chorozo.uid, triggerBucket: "opponentOptional" },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === chorozo.uid && action.effectId === "lua-4-1130");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(restoredTriggerWindow.session.state.attackCanceledUids).toEqual([attacker.uid]);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chorozo.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredTriggerWindow.session.state.cards.find((card) => card.uid === chorozo.uid), restoredTriggerWindow.session.state)).toBe(3500);
    expect(restoredTriggerWindow.session.state.effects.filter((effect) => effect.sourceUid === chorozo.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: chorozo.uid, value: 2500 },
    ]);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget", "breakEffect", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: attacker.uid, eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: attacker.uid, eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: chorozo.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: attacker.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: chorozo.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
    expect(restoredTriggerWindow.session.state.pendingBattle).toBeUndefined();
    expect(restoredTriggerWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Magistus Chorozo");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsType,TYPE_FUSION|TYPE_SYNCHRO|TYPE_XYZ|TYPE_LINK),aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER))");
  expect(script).toContain("Fusion.AddContactProc(c,function(tp) return Duel.GetMatchingGroup(Card.IsAbleToGraveAsCost,tp,LOCATION_ONFIELD,0,nil) end,function(g) Duel.SendtoGrave(g,REASON_COST|REASON_MATERIAL) end,nil,nil,nil,nil,false)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.SetTargetCard(ac)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,ac,1,tp,0)");
  expect(script).toContain("Duel.NegateAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("Duel.AdjustInstantly(c)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const chorozo = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === chorozoCode);
  expect(chorozo).toBeDefined();
  return [
    chorozo!,
    { code: attackerCode, name: "Chorozo Attack Announcer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2500, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
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
