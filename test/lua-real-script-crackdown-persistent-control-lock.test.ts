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
const crackdownCode = "36975314";
const opponentTargetCode = "369753140";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrackdownScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crackdownCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const eventChainSolved = 1022;
const eventLeaveField = 1015;
const effectSetControl = 4;
const effectCannotTrigger = 7;
const effectCannotAttack = 85;
const effectFlagCardTarget = 0x10;
const effectFlagSetAvailable = 0x100;
const effectFlagCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasCrackdownScript)("Lua real script Crackdown persistent control lock", () => {
  it("restores free-chain Continuous Trap activation into persistent control, attack lock, and trigger lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${crackdownCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 36975314, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crackdownCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const crackdown = requireCard(session, crackdownCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    setTrap(session, crackdown);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    prepareMainPhase(session);
    registerCrackdown(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === crackdown.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, code: eventFreeChain, event: "quick", id: `lua-1-${eventFreeChain}`, property: effectFlagCardTarget, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventChainSolved, event: "continuous", id: `lua-2-${eventChainSolved}`, property: effectFlagCannotDisable, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectSetControl, event: "continuous", id: `lua-3-${effectSetControl}`, property: effectFlagSetAvailable, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectCannotAttack, event: "continuous", id: `lua-4-${effectCannotAttack}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectCannotTrigger, event: "continuous", id: `lua-5-${effectCannotTrigger}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventLeaveField, event: "continuous", id: `lua-6-${eventLeaveField}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === crackdown.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, crackdown.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      cardTargetUids: [opponentTarget.uid],
    });
    expect(findCard(restored.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: crackdown.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.effects.find((effect) =>
      effect.sourceUid === opponentTarget.uid && effect.code === effectSetControl
    )).toMatchObject({
      code: effectSetControl,
      event: "continuous",
      sourceUid: opponentTarget.uid,
      value: 0,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === crackdown.uid).map((effect) => effect.code)).toEqual(
      expect.arrayContaining([effectSetControl, effectCannotAttack, effectCannotTrigger]),
    );
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === opponentTarget.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: opponentTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: crackdown.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: crackdownCode, name: "Crackdown", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: opponentTargetCode, name: "Crackdown Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Crackdown");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("e2:SetCondition(aux.PersistentTgCon)");
  expect(script).toContain("c:SetCardTarget(tc)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_CONTROL)");
  expect(script).toContain("e3:SetTarget(aux.PersistentTargetFilter)");
  expect(script).toContain("e4:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e5:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerCrackdown(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crackdownCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function setTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
