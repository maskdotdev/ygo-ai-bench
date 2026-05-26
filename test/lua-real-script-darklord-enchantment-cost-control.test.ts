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
const darklordEnchantmentCode = "87990236";
const costDarklordCode = "879902360";
const ownBlockerCodes = ["879902361", "879902362", "879902363", "879902364"];
const opponentTargetCode = "879902365";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDarklordEnchantmentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darklordEnchantmentCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setDarklord = 0xef;
const categoryControl = 0x2000;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasDarklordEnchantmentScript)("Lua real script Darklord Enchantment cost control", () => {
  it("restores Darklord send-to-grave cost that opens a monster zone before temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darklordEnchantmentCode}.lua`);
    expect(script).toContain("--Darklord Enchantment");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL)>0");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND|LOCATION_MZONE,0,1,1,nil,tp)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,false)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 87990236, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [darklordEnchantmentCode, costDarklordCode, ...ownBlockerCodes] },
      1: { main: [opponentTargetCode] },
    });
    startDuel(session);

    const enchantment = requireCard(session, darklordEnchantmentCode);
    const costDarklord = requireCard(session, costDarklordCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveSetSpellTrap(session, enchantment);
    moveFaceUpAttack(session, costDarklord, 0, 0);
    ownBlockerCodes.forEach((code, index) => moveFaceUpAttack(session, requireCard(session, code), 0, index + 1));
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darklordEnchantmentCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === enchantment.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      countLimitCode: effect.countLimitCode,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      {
        category: categoryControl,
        code: eventFreeChain,
        countLimit: 1,
        countLimitCode: Number(darklordEnchantmentCode),
        event: "quick",
        id: `lua-1-${eventFreeChain}`,
        range: ["spellTrapZone"],
      },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === enchantment.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, enchantment.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(findCard(restored.session, costDarklord.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: enchantment.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: enchantment.uid,
      reasonEffectId: 1,
    });
    expect(ownBlockerCodes.map((code) => requireCard(restored.session, code)).map((card) => ({
      controller: card.controller,
      location: card.location,
      sequence: card.sequence,
    }))).toEqual([
      { controller: 0, location: "monsterZone", sequence: 1 },
      { controller: 0, location: "monsterZone", sequence: 2 },
      { controller: 0, location: "monsterZone", sequence: 3 },
      { controller: 0, location: "monsterZone", sequence: 4 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCardUid: costDarklord.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: enchantment.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "graveyard", previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: enchantment.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "monsterZone", previousController: 1, currentController: 0 },
      { eventName: "sentToGraveyard", eventCardUid: enchantment.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard", previousController: 0, currentController: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: darklordEnchantmentCode, name: "Darklord Enchantment", kind: "trap", typeFlags: typeTrap },
    { code: costDarklordCode, name: "Darklord Enchantment Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDarklord], level: 4, attack: 1600, defense: 1200 },
    ...ownBlockerCodes.map((code, index) => ({ code, name: `Darklord Enchantment Blocker ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, level: 4, attack: 1000 + index, defense: 1000 })),
    { code: opponentTargetCode, name: "Darklord Enchantment Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
  ];
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

function moveSetSpellTrap(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
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
