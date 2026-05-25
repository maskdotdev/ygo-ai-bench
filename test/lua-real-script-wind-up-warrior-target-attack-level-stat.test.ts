import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const warriorCode = "53540729";
const targetCode = "535407290";
const nonWindUpCode = "535407291";
const levelZeroCode = "535407292";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWarriorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${warriorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setWindUp = 0x58;
const effectUpdateAttack = 100;
const effectUpdateLevel = 130;
const effectFlagCannotDisable = 1024;
const effectFlagCardTarget = 16;
const effectFlagNoTurnReset = 0x400000;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasWarriorScript)("Lua real script Wind-Up Warrior target attack level stat", () => {
  it("restores no-turn-reset Wind-Up target ATK and Level boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${warriorCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 53540729, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [warriorCode, targetCode, nonWindUpCode, levelZeroCode] }, 1: { main: [] } });
    startDuel(session);

    const warrior = requireCard(session, warriorCode);
    const target = requireCard(session, targetCode);
    const nonWindUp = requireCard(session, nonWindUpCode);
    const levelZero = requireCard(session, levelZeroCode);
    moveFaceUpAttack(session, warrior, 0, 0);
    moveFaceUpAttack(session, target, 0, 1);
    moveFaceUpAttack(session, nonWindUp, 0, 2);
    moveFaceUpAttack(session, levelZero, 0, 3);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(warriorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === warrior.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagNoTurnReset | effectFlagCardTarget, range: ["monsterZone"], sourceUid: warrior.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === warrior.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === warrior.uid), restored.session.state)).toBe(1800);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === warrior.uid), restored.session.state)).toBe(5);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1200);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(4);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonWindUp.uid), restored.session.state)).toBe(1500);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === levelZero.uid), restored.session.state)).toBe(0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === warrior.uid && [effectUpdateAttack, effectUpdateLevel].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: warrior.uid, value: 600 },
      { code: effectUpdateLevel, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: warrior.uid, value: 1 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: warrior.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === warrior.uid), restoredAfter.session.state)).toBe(1800);
    expect(currentLevel(restoredAfter.session.state.cards.find((card) => card.uid === warrior.uid), restoredAfter.session.state)).toBe(5);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Wind-Up Warrior");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_NO_TURN_RESET+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("s.listed_series={SET_WIND_UP}");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_WIND_UP) and c:IsLevelAbove(1)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(600)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e2:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetValue(1)");
}

function cards(): DuelCardData[] {
  return [
    { code: warriorCode, name: "Wind-Up Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1800, setcodes: [setWindUp] },
    { code: targetCode, name: "Wind-Up Warrior Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000, setcodes: [setWindUp] },
    { code: nonWindUpCode, name: "Wind-Up Warrior Non-Wind-Up Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: levelZeroCode, name: "Wind-Up Warrior Level Zero Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 0, attack: 900, defense: 900, setcodes: [setWindUp] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
