import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
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
const thats10Code = "97223101";
const starterCode = "972231010";
const monsterCode = "972231011";
const trapMonsterCode = "972231012";
const counterAccess = 0x212;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script That's 10 counter set", () => {
  it("restores chain Access Counter gain into ATK boost and 10-counter self-return Trap Monster set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${thats10Code}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 97223101, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [thats10Code, monsterCode, trapMonsterCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const thats10 = requireCard(session, thats10Code);
    const starter = requireCard(session, starterCode);
    const monster = requireCard(session, monsterCode);
    const trapMonster = requireCard(session, trapMonsterCode);
    moveFaceUpSpell(session, thats10, 0);
    expect(addDuelCardCounter(thats10, counterAccess, 9)).toBe(true);
    moveFaceUpAttack(session, monster, 0, 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, source);
    for (const code of [thats10Code, starterCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);
    expect(currentAttack(monster, session.state)).toBe(1900);
    expect(session.state.effects.filter((effect) => effect.sourceUid === thats10.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { code: 0x10000 + counterAccess, event: "continuous", range: ["spellTrapZone"] },
      { code: 0x20000 + counterAccess, event: "continuous", range: ["spellTrapZone"] },
      { code: 1002, event: "ignition", range: ["hand", "spellTrapZone"] },
      { code: 1027, event: "trigger", range: ["spellTrapZone"] },
      { code: 100, event: "continuous", range: ["spellTrapZone"] },
      { code: 0x10000 + counterAccess, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starterAction!);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterResponse = getLuaRestoreLegalActions(restoredCounter, 0).find((action) => action.type === "activateTrigger" && action.uid === thats10.uid);
    expect(counterResponse, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterResponse!);
    passRestoredChain(restoredCounter);
    expect(getDuelCardCounter(findCard(restoredCounter.session, thats10.uid), counterAccess)).toBe(10);
    expect(currentAttack(findCard(restoredCounter.session, monster.uid), restoredCounter.session.state)).toBe(2000);
    expect(restoredCounter.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === thats10.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: thats10.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: thats10.uid,
        eventReasonEffectId: 4,
      },
    ]);

    const restoredSet = restoreDuelWithLuaScripts(serializeDuel(restoredCounter.session), source, reader);
    expectCleanRestore(restoredSet);
    expectRestoredLegalActions(restoredSet, 0);
    const setTrigger = getLuaRestoreLegalActions(restoredSet, 0).find((action) => action.type === "activateTrigger" && action.uid === thats10.uid);
    expect(setTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSet, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSet, setTrigger!);
    passRestoredChain(restoredSet);

    expect(findCard(restoredSet.session, thats10.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: thats10.uid,
      reasonEffectId: 6,
    });
    expect(findCard(restoredSet.session, trapMonster.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
    });
    expect(restoredSet.session.state.effects.filter((effect) => effect.sourceUid === trapMonster.uid).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 16, property: 0x100, reset: { flags: 33427456 }, sourceUid: trapMonster.uid },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === thats10Code),
    { code: starterCode, name: "That's 10 Chain Starter", kind: "spell", typeFlags: typeSpell },
    { code: monsterCode, name: "That's 10 Boosted Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: trapMonsterCode, name: "That's 10 Trap Monster", kind: "trap", typeFlags: typeTrap | typeContinuous, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${starterCode}.lua`) return starterScript();
      return workspace.readScript(name);
    },
  };
}

function starterScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_ACTIVATE)
  e:SetCode(EVENT_FREE_CHAIN)
  e:SetOperation(function(e,tp) Debug.Message("that's 10 starter resolved") end)
  c:RegisterEffect(e)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("That's 10!");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_ACCESS,LOCATION_STZONE)");
  expect(script).toContain("c:SetCounterLimit(COUNTER_ACCESS,10)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_CODE,CHAININFO_TRIGGERING_CODE2)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,tp,COUNTER_ACCESS)");
  expect(script).toContain("c:AddCounter(COUNTER_ACCESS,1)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_ACCESS)*100");
  expect(script).toContain("e3:SetCode(EVENT_ADD_COUNTER+COUNTER_ACCESS)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_ACCESS)==10");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil,false)");
  expect(script).toContain("Duel.SSet(tp,sc)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_TRAP_ACT_IN_SET_TURN)");
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "declineTrigger" || action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
