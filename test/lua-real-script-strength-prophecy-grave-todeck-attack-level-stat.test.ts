import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const strengthCode = "13002461";
const spellbookCostCode = "130024610";
const targetCode = "130024611";
const warriorDecoyCode = "130024612";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasStrengthScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${strengthCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const setSpellbook = 0x106e;
const effectUpdateAttack = 100;
const effectUpdateLevel = 130;
const effectFlagCannotDisable = 1024;
const effectFlagCardTarget = 16;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasStrengthScript)("Lua real script Strength of Prophecy grave toDeck attack level stat", () => {
  it("restores Spellbook grave-to-Deck cost into Spellcaster ATK and Level boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${strengthCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 13002461, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [strengthCode, spellbookCostCode, targetCode, warriorDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const strength = requireCard(session, strengthCode);
    const spellbookCost = requireCard(session, spellbookCostCode);
    const target = requireCard(session, targetCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    moveFaceUpAttack(session, strength, 0, 0);
    moveDuelCard(session.state, spellbookCost.uid, "graveyard", 0);
    moveFaceUpAttack(session, target, 0, 1);
    moveFaceUpAttack(session, warriorDecoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(strengthCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === strength.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      luaCostDescriptor: effect.luaCostDescriptor,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", luaCostDescriptor: undefined, luaTargetDescriptor: "target:faceup-race-level-above:2:1", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: strength.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === strength.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === spellbookCost.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: strength.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === strength.uid), restored.session.state)).toBe(2000);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === strength.uid), restored.session.state)).toBe(5);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1500);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === strength.uid && [effectUpdateAttack, effectUpdateLevel].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetEventStandard }, sourceUid: strength.uid, value: 500 },
      { code: effectUpdateLevel, property: effectFlagCannotDisable, reset: { flags: resetEventStandard }, sourceUid: strength.uid, value: 1 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToDeck", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: spellbookCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: strength.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: strength.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === strength.uid), restoredAfter.session.state)).toBe(2000);
    expect(currentLevel(restoredAfter.session.state.cards.find((card) => card.uid === strength.uid), restoredAfter.session.state)).toBe(5);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Strength of Prophecy");
  expect(script).toContain("s.listed_series={SET_SPELLBOOK}");
  expect(script).toContain("return c:IsSetCard(SET_SPELLBOOK) and c:IsSpell() and c:IsAbleToDeckAsCost()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_COST)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_SPELLCASTER) and c:IsLevelAbove(1)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e2:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e2:SetValue(1)");
}

function cards(): DuelCardData[] {
  return [
    { code: strengthCode, name: "Strength of Prophecy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeEarth, level: 4, attack: 1500, defense: 1400 },
    { code: spellbookCostCode, name: "Strength of Prophecy Spellbook Cost", kind: "spell", typeFlags: typeSpell, setcodes: [setSpellbook] },
    { code: targetCode, name: "Strength of Prophecy Spellcaster Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: warriorDecoyCode, name: "Strength of Prophecy Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
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
