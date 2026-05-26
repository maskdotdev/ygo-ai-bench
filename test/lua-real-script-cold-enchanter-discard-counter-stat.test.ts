import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const enchanterCode = "24661486";
const discardCode = "246614860";
const targetCode = "246614861";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEnchanterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${enchanterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const counterIce = 0x1015;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasEnchanterScript)("Lua real script Cold Enchanter discard counter stat", () => {
  it("restores discard cost into targeted Ice Counter placement and Duel.GetCounter ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${enchanterCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const enchanter = requireCard(restoredOpen.session, enchanterCode);
    const discard = requireCard(restoredOpen.session, discardCode);
    const target = requireCard(restoredOpen.session, targetCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === enchanter.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x800000, code: undefined, event: "ignition", id: "lua-1", property: 16, range: ["monsterZone"] },
      { category: undefined, code: effectUpdateAttack, event: "continuous", id: "lua-2-100", property: 131072, range: ["monsterZone"] },
    ]);
    expect(currentAttack(findCard(restoredOpen.session, enchanter.uid), restoredOpen.session.state)).toBe(1600);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === enchanter.uid && action.effectId === "lua-1");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: enchanter.uid,
      reasonEffectId: 1,
    });
    expect(getDuelCardCounter(findCard(restoredOpen.session, enchanter.uid), counterIce)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredOpen.session, target.uid), counterIce)).toBe(0);
    expect(currentAttack(findCard(restoredOpen.session, enchanter.uid), restoredOpen.session.state)).toBe(1900);
    expect(currentAttack(findCard(restoredOpen.session, target.uid), restoredOpen.session.state)).toBe(900);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "becameTarget", "counterAdded"].includes(event.eventName)).map((event) => eventSummary(event))).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: discard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: enchanter.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: enchanter.uid, eventReasonEffectId: 1 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: enchanter.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: enchanter.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: enchanter.uid, eventReasonEffectId: 1 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(findCard(restoredStat.session, enchanter.uid), restoredStat.session.state)).toBe(1900);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const enchanter = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === enchanterCode);
  expect(enchanter).toBeDefined();
  return [
    enchanter!,
    { code: discardCode, name: "Cold Enchanter Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Cold Enchanter Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 1200 },
  ];
}

function createRestoredOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 24661486, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [enchanterCode, discardCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, enchanterCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(enchanterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cold Enchanter");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,e:GetHandler())");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,0x1015,1)");
  expect(script).toContain("tc:AddCounter(0x1015,1)");
  expect(script).toContain("return Duel.GetCounter(0,1,1,0x1015)*300");
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
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function eventSummary(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonPlayer?: PlayerId; eventReasonCardUid?: string; eventReasonEffectId?: number }) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
