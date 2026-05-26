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
const aeropixCode = "83094004";
const opponentTargetCode = "830940040";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAeropixScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aeropixCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const attributeWind = 0x10;
const counterAeropix = 0x1207;
const categoryCounter = 0x800000;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAeropixScript)("Lua real script Aeropixthree counter zone stat", () => {
  it("restores target-paired zone movement into counter placement and ATK/DEF reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${aeropixCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const aeropix = requireCard(restoredOpen.session, aeropixCode);
    const target = requireCard(restoredOpen.session, opponentTargetCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === aeropix.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: categoryCounter, code: 1002, countLimit: 1, event: "quick", id: "lua-1-1002", property: 16, range: ["monsterZone"], targetRange: undefined },
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", id: "lua-2-100", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
      { category: undefined, code: effectUpdateDefense, countLimit: undefined, event: "continuous", id: "lua-3-104", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
    ]);

    expect(currentAttack(target, restoredOpen.session.state)).toBe(1700);
    expect(currentDefense(target, restoredOpen.session.state)).toBe(1200);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === aeropix.uid && action.effectId === "lua-1-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectDisableField")).toEqual([
      { id: "lua-prompt-1", api: "SelectDisableField", player: 0, options: [1, 2, 8, 16], descriptions: [1, 2, 8, 16], returned: 1 },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === aeropix.uid)).toMatchObject({ location: "monsterZone", controller: 0, sequence: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", controller: 1, sequence: 4 });
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), counterAeropix)).toBe(1);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1500);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1000);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(1500);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(1000);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["becameTarget", "breakEffect", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1 },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: aeropix.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: aeropix.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
    ]);
  });
});

function createRestoredOpen(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 83094004, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [aeropixCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, aeropixCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(aeropixCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const aeropix = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === aeropixCode);
  expect(aeropix).toBeDefined();
  return [
    aeropix!,
    { code: opponentTargetCode, name: "Aeropixthree Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeWind, level: 4, attack: 1700, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Aeropixthree");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("s.counter_place_list={0x1207}");
  expect(script).toContain("local g=e:GetHandler():GetColumnGroup()");
  expect(script).toContain("Duel.SelectTarget(tp,s.seqfilter,tp,0,LOCATION_MZONE,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectDisableField(tp,1,LOCATION_MZONE,0,0xffffff&(~zone))");
  expect(script).toContain("Duel.MoveSequence(c,math.log(selzone,2))");
  expect(script).toContain("Duel.MoveSequence(tc,4-math.log(selzone,2))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("tc:AddCounter(0x1207,1)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return c:GetCounter(0x1207)*-200");
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
