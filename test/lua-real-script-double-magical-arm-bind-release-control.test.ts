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
const armBindCode = "72621670";
const releaseCodes = ["726216700", "726216701"];
const opponentTargetCodes = ["726216702", "726216703"];
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasArmBindScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${armBindCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const categoryControl = 0x2000;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasArmBindScript)("Lua real script Double Magical Arm Bind release control", () => {
  it("restores two-release cost into targeted group control from chain target cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${armBindCode}.lua`);
    expect(script).toContain("--Double Magical Arm Bind");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,nil,2,false,s.chk,nil,dg)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,nil,2,2,false,s.chk,nil,dg)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,2,2,nil)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS):Filter(s.tfilter,nil,e)");
    expect(script).toContain("Duel.GetControl(g,tp,PHASE_END,rct)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 72621670, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [armBindCode, ...releaseCodes] },
      1: { main: opponentTargetCodes },
    });
    startDuel(session);

    const armBind = requireCard(session, armBindCode);
    const releases = releaseCodes.map((code) => requireCard(session, code));
    const targets = opponentTargetCodes.map((code) => requireCard(session, code));
    const [firstRelease, secondRelease] = releases as [DuelCardInstance, DuelCardInstance];
    const [firstTarget, secondTarget] = targets as [DuelCardInstance, DuelCardInstance];
    moveSetSpellTrap(session, armBind);
    releases.forEach((card, sequence) => moveFaceUpAttack(session, card, 0, sequence));
    targets.forEach((card, sequence) => moveFaceUpAttack(session, card, 1, sequence));
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(armBindCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === armBind.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      {
        category: categoryControl,
        code: eventFreeChain,
        event: "quick",
        id: `lua-1-${eventFreeChain}`,
        property: 0x10,
        range: ["spellTrapZone"],
      },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === armBind.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    expect(restored.session.state.chain).toEqual([]);
    resolveRestoredChain(restored);

    expect(releases.map((card) => findCard(restored.session, card.uid)).map((card) => ({
      controller: card.controller,
      location: card.location,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual([
      { controller: 0, location: "graveyard", reason: duelReason.release | duelReason.cost, reasonCardUid: armBind.uid, reasonEffectId: 1, reasonPlayer: 0 },
      { controller: 0, location: "graveyard", reason: duelReason.release | duelReason.cost, reasonCardUid: armBind.uid, reasonEffectId: 1, reasonPlayer: 0 },
    ]);
    expect(targets.map((card) => findCard(restored.session, card.uid)).map((card) => ({
      controller: card.controller,
      location: card.location,
      previousController: card.previousController,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual([
      { controller: 0, location: "monsterZone", previousController: 1, reason: duelReason.effect, reasonCardUid: armBind.uid, reasonEffectId: 1, reasonPlayer: 0 },
      { controller: 0, location: "monsterZone", previousController: 1, reason: duelReason.effect, reasonCardUid: armBind.uid, reasonEffectId: 1, reasonPlayer: 0 },
    ]);
    expect(findCard(restored.session, armBind.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["released", "controlChanged", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
    }))).toEqual([
      { currentController: 0, currentLocation: "graveyard", eventCardUid: firstRelease.uid, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined, previousController: 0, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: firstRelease.uid, eventName: "sentToGraveyard", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined, previousController: 0, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: secondRelease.uid, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined, previousController: 0, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: secondRelease.uid, eventName: "sentToGraveyard", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined, previousController: 0, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: firstRelease.uid, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: releases.map((card) => card.uid), previousController: 0, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: firstTarget.uid, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined, previousController: 1, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: secondTarget.uid, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined, previousController: 1, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: firstTarget.uid, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: armBind.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: targets.map((card) => card.uid), previousController: 1, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: armBind.uid, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, previousController: 0, previousLocation: "spellTrapZone" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: armBindCode, name: "Double Magical Arm Bind", kind: "trap", typeFlags: typeTrap },
    ...releaseCodes.map((code, index) => ({ code, name: `Double Magical Arm Bind Release ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, level: 4, attack: 1000 + index, defense: 1000 })),
    ...opponentTargetCodes.map((code, index) => ({ code, name: `Double Magical Arm Bind Target ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, level: 4, attack: 1800 + index, defense: 1000 })),
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
