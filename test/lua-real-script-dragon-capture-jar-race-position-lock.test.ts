import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts)("Lua real script Dragon Capture Jar race position lock", () => {
  it("restores race-targeted field position setting and cloned cannot-change-position lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const jarCode = "50045299";
    const defenderCode = "50045300";
    const dragonCode = "50045301";
    const warriorCode = "50045302";
    const responderCode = "50045303";
    const cards: DuelCardData[] = [
      { code: jarCode, name: "Dragon Capture Jar", kind: "trap", typeFlags: typeTrap | typeContinuous },
      { code: defenderCode, name: "Dragon Capture Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: dragonCode, name: "Dragon Capture Dragon", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 4, attack: 1800, defense: 1200 },
      { code: warriorCode, name: "Dragon Capture Warrior", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Dragon Capture Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5004, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jarCode, defenderCode] }, 1: { main: [dragonCode, warriorCode, responderCode] } });
    startDuel(session);

    const jar = requireCard(session, jarCode);
    const defender = requireCard(session, defenderCode);
    const dragon = requireCard(session, dragonCode);
    const warrior = requireCard(session, warriorCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, jar.uid, "spellTrapZone", 0);
    jar.position = "faceDown";
    jar.faceUp = false;
    moveDuelCard(session.state, defender.uid, "monsterZone", 0);
    defender.position = "faceUpAttack";
    defender.faceUp = true;
    moveDuelCard(session.state, dragon.uid, "monsterZone", 1);
    dragon.position = "faceUpAttack";
    dragon.faceUp = true;
    moveDuelCard(session.state, warrior.uid, "monsterZone", 1);
    warrior.position = "faceUpAttack";
    warrior.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jarCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === jar.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === jar.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("dragon capture responder resolved");
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === jar.uid && (effect.code === 140 || effect.code === 14)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 140, event: "continuous", luaTargetDescriptor: "target:race:8192", targetRange: [4, 4], value: 4 },
      { code: 14, event: "continuous", luaTargetDescriptor: "target:race:8192", targetRange: [4, 4], value: 4 },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredPersistent);
    restoredPersistent.session.state.turnPlayer = 1;
    restoredPersistent.session.state.waitingFor = 1;
    restoredPersistent.session.state.phase = "main1";
    expectRestoredLegalActions(restoredPersistent, 1);
    expect(getLuaRestoreLegalActions(restoredPersistent, 1).some((action) => action.type === "changePosition" && action.uid === dragon.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredPersistent, 1).some((action) => action.type === "changePosition" && action.uid === warrior.uid)).toBe(true);

    const battle = getLuaRestoreLegalActions(restoredPersistent, 1).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, battle!);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 1).filter((action) => action.type === "declareAttack");
    expect(battleActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "declareAttack", attackerUid: warrior.uid, targetUid: defender.uid })]),
    );
    expect(battleActions.some((action) => action.attackerUid === dragon.uid)).toBe(false);

    const probe = restoredBattle.host.loadScript(positionProbeScript(dragonCode, warriorCode), "dragon-capture-position-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredBattle.host.messages).toContain("dragon capture position true/4/true/true/false");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("dragon capture responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function positionProbeScript(dragonCode: string, warriorCode: string): string {
  return `
    local dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonCode}),0,0,LOCATION_MZONE,nil)
    local warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message(
      "dragon capture position " ..
      tostring(dragon and dragon:IsDefensePos()) .. "/" ..
      tostring(dragon and dragon:GetPosition()) .. "/" ..
      tostring(warrior and warrior:IsAttackPos()) .. "/" ..
      tostring(warrior and warrior:CanAttack()) .. "/" ..
      tostring(dragon and dragon:CanAttack())
    )
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
