import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const shadowMosquitoCode = "32453837";
const materialCode = "324538370";
const attackerCode = "324538371";
const counterTargetCode = "324538372";
const hallucinationCounter = 0x1101;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Number 2 Shadow Mosquito counter damage", () => {
  it("restores Attack Announce SelectEffect counter branch into detach, Hallucination Counter placement, and target disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${shadowMosquitoCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 32453837, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [shadowMosquitoCode] }, 1: { main: [attackerCode, counterTargetCode] } });
    startDuel(session);

    const shadowMosquito = requireCard(session, shadowMosquitoCode);
    const material = requireCard(session, materialCode);
    const attacker = requireCard(session, attackerCode);
    const counterTarget = requireCard(session, counterTargetCode);
    moveFaceUpAttack(session, shadowMosquito, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    shadowMosquito.overlayUids.push(material.uid);
    moveFaceUpAttack(session, attacker, 1);
    moveFaceUpAttack(session, counterTarget, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = fixtureSource(workspace);
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(shadowMosquitoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(attackerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(counterTargetCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.filter((effect) => effect.sourceUid === shadowMosquito.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", range: ["monsterZone"], targetRange: undefined, value: undefined },
      { code: 42, event: "continuous", range: ["monsterZone"], targetRange: undefined, value: 1 },
      { code: 201, event: "continuous", range: ["monsterZone"], targetRange: undefined, value: 1 },
      { code: 191, event: "continuous", range: ["monsterZone"], targetRange: [0, 4], value: undefined },
      { code: 1130, event: "trigger", range: ["monsterZone"], targetRange: undefined, value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    attackAndOpenTrigger(restoredOpen, attacker.uid, shadowMosquito.uid);

    const restoredCounterChoice = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredCounterChoice);
    expectRestoredLegalActions(restoredCounterChoice, 0);
    const trigger = getLuaRestoreLegalActions(restoredCounterChoice, 0).find((action) => action.type === "activateTrigger" && action.uid === shadowMosquito.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounterChoice, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounterChoice, trigger!);

    expect(restoredCounterChoice.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect")).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1], descriptions: [519261392], returned: 1 },
    ]);
    expect(restoredCounterChoice.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: shadowMosquito.uid,
    });
    expect(restoredCounterChoice.session.state.cards.find((card) => card.uid === shadowMosquito.uid)?.overlayUids).toEqual([]);
    expect(getDuelCardCounter(restoredCounterChoice.session.state.cards.find((card) => card.uid === attacker.uid), hallucinationCounter)).toBe(1);
    expect(restoredCounterChoice.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
    }))).toEqual([
      { code: 0x10000 + hallucinationCounter, event: "continuous", reset: undefined },
      { code: 2, event: "continuous", reset: { flags: 33427456 } },
    ]);
    expect(restoredCounterChoice.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === attacker.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: attacker.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shadowMosquito.uid,
        eventReasonEffectId: 5,
      },
    ]);
  });

  it("restores Attack Announce SelectEffect damage branch from a Hallucination Counter monster ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 32453838, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [shadowMosquitoCode] }, 1: { main: [attackerCode, counterTargetCode] } });
    startDuel(session);

    const shadowMosquito = requireCard(session, shadowMosquitoCode);
    const attacker = requireCard(session, attackerCode);
    const counterTarget = requireCard(session, counterTargetCode);
    moveFaceUpAttack(session, shadowMosquito, 0);
    moveFaceUpAttack(session, attacker, 1);
    moveFaceUpAttack(session, counterTarget, 1);
    counterTarget.counters = { [hallucinationCounter]: 1 };
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = fixtureSource(workspace);
    const host = createLuaScriptHost(session, source, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }] });
    expect(host.loadCardScript(Number(shadowMosquitoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(attackerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(counterTargetCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    attackAndOpenTrigger(restoredOpen, attacker.uid, shadowMosquito.uid);

    const restoredDamageChoice = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredDamageChoice);
    expectRestoredLegalActions(restoredDamageChoice, 0);
    const trigger = getLuaRestoreLegalActions(restoredDamageChoice, 0).find((action) => action.type === "activateTrigger" && action.uid === shadowMosquito.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamageChoice, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageChoice, trigger!);
    expect(restoredDamageChoice.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect")).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [2], descriptions: [519261393], returned: 2 },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredDamageChoice.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.players[1].lifePoints).toBe(6400);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1600,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shadowMosquito.uid,
        eventReasonEffectId: 5,
      },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shadowMosquitoCode),
    { code: materialCode, name: "Shadow Mosquito Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 500, defense: 500 },
    { code: attackerCode, name: "Shadow Mosquito Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: counterTargetCode, name: "Shadow Mosquito Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${attackerCode}.lua` || name === `c${counterTargetCode}.lua`) return counterTargetScript();
      return workspace.readScript(name);
    },
  };
}

function counterTargetScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  c:EnableCounterPermit(0x1101,LOCATION_MZONE)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("--Number 2: Ninja Shadow Mosquito");
  expect(script).toContain("Xyz.AddProcedure(c,nil,2,2,nil,nil,Xyz.InfiniteMats)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e3:SetCode(EFFECT_MUST_ATTACK)");
  expect(script).toContain("e4:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("s.counter_place_list={0x1101}");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)");
  expect(script).toContain("tc:AddCounter(0x1101,1)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("Duel.Damage(1-tp,tc:GetAttack(),REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function attackAndOpenTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, 1).find(
    (action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid,
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  expect(restored.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
    {
      player: 0,
      effectId: "lua-5-1130",
      sourceUid: targetUid,
      eventName: "attackDeclared",
      eventCode: 1130,
      eventCardUid: attackerUid,
      eventPlayer: 1,
      eventReason: 0,
      eventReasonPlayer: 1,
      eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
      eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      eventUids: [attackerUid, targetUid],
      eventTriggerTiming: "when",
      triggerBucket: "opponentOptional",
    },
  ]);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
