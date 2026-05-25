import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const wildNatureCode = "61166988";
const beastCode = "611669880";
const warriorCode = "611669881";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const eventPhaseEnd = 0x1200;
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wild Nature's Release defense attack End Phase destroy", () => {
  it("restores DEF-based ATK gain and delayed self-destroy on the targeted Beast", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${wildNatureCode}.lua`));
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wildNatureCode),
      { code: beastCode, name: "Wild Nature Beast Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
      { code: warriorCode, name: "Wild Nature Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 61166988, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wildNatureCode, beastCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);
    const wildNature = requireCard(session, wildNatureCode);
    const beast = requireCard(session, beastCode);
    const warrior = requireCard(session, warriorCode);
    moveDuelCard(session.state, wildNature.uid, "hand", 0);
    moveFaceUpAttack(session, beast, 0, 0);
    moveFaceUpAttack(session, warrior, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wildNatureCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === wildNature.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === wildNature.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === beast.uid), restoredOpen.session.state)).toBe(2700);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === warrior.uid), restoredOpen.session.state)).toBe(1600);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === beast.uid).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      triggerCode: effect.triggerCode,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        countLimit: undefined,
        event: "continuous",
        range: ["monsterZone"],
        registryKey: `lua:${wildNatureCode}:lua-2-100`,
        reset: { flags: 0x41fe1200 },
        sourceUid: beast.uid,
        triggerCode: undefined,
        triggerEvent: undefined,
        value: 1200,
      },
      {
        code: eventPhaseEnd,
        countLimit: 1,
        event: "continuous",
        range: ["monsterZone"],
        registryKey: `lua:${wildNatureCode}:lua-3-4608`,
        reset: { flags: 0x41fe1200 },
        sourceUid: beast.uid,
        triggerCode: undefined,
        triggerEvent: undefined,
        value: undefined,
      },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === beast.uid), restoredBoost.session.state)).toBe(2700);
    restoredBoost.session.state.phase = "main2";
    restoredBoost.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, endPhase!);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: eventPhaseEnd }]);
    expect(restoredBoost.session.state.chain).toEqual([]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === beast.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: effectDestroyReason,
    });
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === beast.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: beast.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 1,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: beast.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Wild Nature's Release");
  expect(script).toContain("c:HasNonZeroDefense() and c:IsRace(RACE_BEAST|RACE_BEASTWARRIOR)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetDefense())");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
  expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
