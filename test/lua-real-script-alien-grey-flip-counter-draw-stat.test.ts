import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const alienGreyCode = "62437709";
const alienAttackerCode = "624377090";
const counterTargetCode = "624377091";
const drawCardCode = "624377092";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAlienGreyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alienGreyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setAlien = 0xc;
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasAlienGreyScript)("Lua real script Alien Grey flip counter draw stat", () => {
  it("restores flip A-Counter placement, flip-flag battle-destroyed draw, and battle target stat loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${alienGreyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredFlipOpen = createRestoredFlipState(reader, workspace);
    expectCleanRestore(restoredFlipOpen);
    expectRestoredLegalActions(restoredFlipOpen, 0);
    const alienGrey = requireCard(restoredFlipOpen.session, alienGreyCode);
    const alienAttacker = requireCard(restoredFlipOpen.session, alienAttackerCode);
    const flip = getLuaRestoreLegalActions(restoredFlipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === alienGrey.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredFlipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipOpen, flip!);

    const restoredFlipTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredFlipOpen.session), workspace, reader);
    expectCleanRestore(restoredFlipTrigger);
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    const placeCounter = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === alienGrey.uid);
    expect(placeCounter, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipTrigger, placeCounter!);
    resolveRestoredChain(restoredFlipTrigger);

    expect(getDuelCardCounter(findCard(restoredFlipTrigger.session, alienAttacker.uid), counterA)).toBe(1);
    expect(restoredFlipTrigger.session.state.eventHistory.filter((event) => ["flipSummoned", "becameTarget", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "flipSummoned", eventCardUid: alienGrey.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "becameTarget", eventCardUid: alienAttacker.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCardUid: alienAttacker.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: alienGrey.uid, eventReasonEffectId: 1 },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredFlipTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 1;
    restoredBattle.session.state.waitingFor = 1;
    attackAndReachBattleDestroyedTrigger(restoredBattle, 1, alienAttacker.uid, alienGrey.uid);
    expect(currentAttack(findCard(restoredBattle.session, alienAttacker.uid), restoredBattle.session.state)).toBe(2000);
    expect(currentDefense(findCard(restoredBattle.session, alienAttacker.uid), restoredBattle.session.state)).toBe(1200);

    const restoredDrawTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDrawTrigger);
    expectRestoredLegalActions(restoredDrawTrigger, 0);
    const drawTrigger = getLuaRestoreLegalActions(restoredDrawTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === alienGrey.uid);
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDrawTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDrawTrigger, drawTrigger!);
    resolveRestoredChain(restoredDrawTrigger);

    expect(findCard(restoredDrawTrigger.session, drawCardCode)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredDrawTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "cardsDrawn"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "battleDestroyed", eventCardUid: alienGrey.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: alienAttacker.uid, eventReasonEffectId: undefined },
      { eventName: "cardsDrawn", eventCardUid: findCard(restoredDrawTrigger.session, drawCardCode).uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: alienGrey.uid, eventReasonEffectId: 3 },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const alienGrey = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === alienGreyCode);
  expect(alienGrey).toBeDefined();
  return [
    alienGrey!,
    { code: alienAttackerCode, name: "Alien Grey Alien Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], race: raceReptile, attribute: attributeLight, level: 4, attack: 2000, defense: 1200 },
    { code: counterTargetCode, name: "Alien Grey Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1500, defense: 1300 },
    { code: drawCardCode, name: "Alien Grey Draw Card", kind: "monster", typeFlags: typeMonster, race: raceReptile, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredFlipState(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 62437709, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [alienGreyCode, drawCardCode] }, 1: { main: [alienAttackerCode, counterTargetCode] } });
  startDuel(session);
  const alienGrey = moveDuelCard(session.state, requireCard(session, alienGreyCode).uid, "monsterZone", 0);
  alienGrey.position = "faceDownDefense";
  alienGrey.faceUp = false;
  moveFaceUpAttack(session, requireCard(session, alienAttackerCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, counterTargetCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerAlienGrey(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerAlienGrey(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(alienGreyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Alien Grey");
  expect(script).toContain("s.counter_place_list={COUNTER_A}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
  expect(script).toContain("e2:SetCode(EVENT_FLIP)");
  expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD_EXC_GRAVE,0,0)");
  expect(script).toContain("e3:SetCategory(CATEGORY_DRAW)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("e:GetHandler():GetFlagEffect(id)~=0");
  expect(script).toContain("Duel.SetTargetParam(1)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
  expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
  expect(script).toContain("c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)");
  expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uidOrCode: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uidOrCode || candidate.code === uidOrCode);
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

function attackAndReachBattleDestroyedTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  expectRestoredLegalActions(restored, player);
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
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
