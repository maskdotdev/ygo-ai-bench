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
const mindPollutantCode = "69257165";
const costCode = "692571650";
const matchingTargetCode = "692571651";
const levelDecoyCode = "692571652";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMindPollutantScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mindPollutantCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const categoryControl = 0x2000;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasMindPollutantScript)("Lua real script Mind Pollutant discard level control", () => {
  it("restores discard-cost Level label into matching opponent monster control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mindPollutantCode}.lua`);
    expect(script).toContain("--Mind Pollutant");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.ctfilter,tp,LOCATION_HAND,0,1,nil,tp)");
    expect(script).toContain("local lv=sg:GetFirst():GetLevel()");
    expect(script).toContain("e:SetLabel(lv)");
    expect(script).toContain("Duel.SendtoGrave(sg,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("Duel.SelectTarget(tp,s.ctffilter,tp,0,LOCATION_MZONE,1,1,nil,lv)");
    expect(script).toContain("tc:GetLevel()==e:GetLabel()");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 69257165, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mindPollutantCode, costCode] }, 1: { main: [matchingTargetCode, levelDecoyCode] } });
    startDuel(session);

    const mindPollutant = requireCard(session, mindPollutantCode);
    const cost = requireCard(session, costCode);
    const matchingTarget = requireCard(session, matchingTargetCode);
    const levelDecoy = requireCard(session, levelDecoyCode);
    moveSetSpellTrap(session, mindPollutant);
    moveDuelCard(session.state, cost.uid, "hand", 0);
    moveFaceUpAttack(session, matchingTarget, 1, 0);
    moveFaceUpAttack(session, levelDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mindPollutantCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === mindPollutant.uid).map((effect) => ({
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
      action.type === "activateEffect" && action.uid === mindPollutant.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    expect(restored.session.state.chain).toEqual([]);

    expect(findCard(restored.session, cost.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonCardUid: mindPollutant.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(findCard(restored.session, matchingTarget.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      previousController: 1,
      reason: duelReason.effect,
      reasonCardUid: mindPollutant.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(findCard(restored.session, levelDecoy.uid)).toMatchObject({
      controller: 1,
      location: "monsterZone",
    });
    expect(findCard(restored.session, mindPollutant.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "controlChanged"].includes(event.eventName)).map((event) => ({
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
    }))).toEqual([
      { currentController: 0, currentLocation: "graveyard", eventCardUid: cost.uid, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: mindPollutant.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 0, previousLocation: "hand" },
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: matchingTarget.uid, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: mindPollutant.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 1, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: mindPollutant.uid, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previousController: 0, previousLocation: "spellTrapZone" },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: mindPollutantCode, name: "Mind Pollutant", kind: "trap", typeFlags: typeTrap },
    { code: costCode, name: "Mind Pollutant Level Four Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: matchingTargetCode, name: "Mind Pollutant Matching Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    { code: levelDecoyCode, name: "Mind Pollutant Level Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1500, defense: 1000 },
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
