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
const diceDungeonCode = "11808215";
const dimensionDiceCode = "47292920";
const ownMonsterCode = "118082150";
const opponentMonsterCode = "118082151";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDiceDungeonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${diceDungeonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDiceDungeonScript)("Lua real script Dice Dungeon search battle-start dice stat", () => {
  it("restores field activation optional search into battle-start two-player dice ATK changes", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${diceDungeonCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 79, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [diceDungeonCode, dimensionDiceCode, ownMonsterCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const diceDungeon = requireCard(session, diceDungeonCode);
    const dimensionDice = requireCard(session, dimensionDiceCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, diceDungeon.uid, "hand", 0);
    moveFaceUpAttack(session, ownMonster, 0);
    moveFaceUpAttack(session, opponentMonster, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(diceDungeonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activateField = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === diceDungeon.uid);
    expect(activateField, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activateField!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 188931440, returned: true },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === diceDungeon.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === dimensionDice.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: diceDungeon.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: dimensionDice.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: diceDungeon.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: dimensionDice.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: diceDungeon.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: dimensionDice.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: diceDungeon.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "hand" },
    ]);

    const restoredActivated = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredActivated);
    expectRestoredLegalActions(restoredActivated, 0);
    const battle = getLuaRestoreLegalActions(restoredActivated, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredActivated, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivated, battle!);
    expect(restoredActivated.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-2-4104",
        eventCode: 4104,
        eventName: "phaseBattle",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: diceDungeon.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredActivated.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === diceDungeon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastDiceResults).toEqual([4]);
    expect(restoredTrigger.session.state.randomCounter).toBe(2);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownMonster.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentMonster.uid), restoredTrigger.session.state)).toBe(2100);
    expect(restoredTrigger.session.state.effects.filter((effect) => [ownMonster.uid, opponentMonster.uid].includes(effect.sourceUid ?? "")).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, sourceUid: ownMonster.uid, value: -500 },
      { code: 100, reset: { flags: 1107169792 }, sourceUid: opponentMonster.uid, value: 500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["phaseBattle", "diceTossed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "phaseBattle", eventCode: 4104, eventPlayer: undefined, eventValue: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "diceTossed", eventCode: 1150, eventPlayer: 0, eventValue: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: diceDungeon.uid, eventReasonEffectId: 2 },
      { eventName: "diceTossed", eventCode: 1150, eventPlayer: 1, eventValue: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: diceDungeon.uid, eventReasonEffectId: 2 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DICE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_BATTLE_START)");
  expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,1,PLAYER_ALL,0)");
  expect(script).toContain("local res1=Duel.TossDice(turn_p,1)");
  expect(script).toContain("local res2=Duel.TossDice(1-turn_p,1)");
  expect(script).toContain("g1:ForEach(s.atkchange,res1,c)");
  expect(script).toContain("g2:ForEach(s.atkchange,res2,c)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => [diceDungeonCode, dimensionDiceCode].includes(card.code)),
    { code: ownMonsterCode, name: "Dice Dungeon Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: opponentMonsterCode, name: "Dice Dungeon Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
  ];
}

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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
