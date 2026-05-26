import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentRace } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const alienBrainCode = "17490535";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAlienBrainScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alienBrainCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const raceWarrior = 0x1;
const raceReptile = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAlienBrainScript)("Lua real script Alien Brain battle-destroyed control race", () => {
  it("restores battle-destroyed Reptile trigger into destroyer control and race change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reptileCode = "17490536";
    const attackerCode = "17490537";
    const script = workspace.readScript(`c${alienBrainCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("ec==Duel.GetAttackTarget()");
    expect(script).toContain("local tc=eg:GetFirst():GetReasonCard()");
    expect(script).toContain("Duel.GetControl(tc,tp)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_RACE)");

    const cards: DuelCardData[] = [
      { code: alienBrainCode, name: "Alien Brain", kind: "trap", typeFlags: typeTrap },
      { code: reptileCode, name: "Alien Brain Destroyed Reptile", kind: "monster", typeFlags: typeMonster, race: raceReptile, level: 4, attack: 800, defense: 1000 },
      { code: attackerCode, name: "Alien Brain Battle Destroyer", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 17490535, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alienBrainCode, reptileCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const alienBrain = requireCard(session, alienBrainCode);
    const reptile = requireCard(session, reptileCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, alienBrain.uid, "spellTrapZone", 0);
    alienBrain.position = "faceDown";
    alienBrain.faceUp = false;
    alienBrain.turnId = 0;
    moveDuelCard(session.state, reptile.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alienBrainCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === reptile.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, attack!);
    passBattleResponses(restoredInitial.session);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: reptile.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateEffect" && action.uid === alienBrain.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "chainSolved")).toEqual([
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
      },
    ]);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === reptile.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    const controlledAttacker = restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid);
    expect(controlledAttacker).toMatchObject({ location: "monsterZone", controller: 0, previousController: 1 });
    expect(currentRace(controlledAttacker, restoredTrigger.session.state)).toBe(raceReptile);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: 122,
        controller: 0,
        event: "continuous",
        id: "lua-2-122",
        range: ["monsterZone"],
        registryKey: "lua:17490535:lua-2-122",
        reset: { flags: 33427456 },
        sourceUid: attacker.uid,
        value: raceReptile,
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "controlChanged")).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: attacker.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: alienBrain.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
