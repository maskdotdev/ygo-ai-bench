import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dragostapeliaCode = "69946549";
const targetCode = "699465490";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDragostapeliaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragostapeliaCode}.lua`));
const counterPredator = 0x1041;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const racePlant = 0x400;
const attributeDark = 0x20;
const categoryCounter = 0x800000;
const effectFusionMaterial = 31;
const effectChangeLevel = 131;
const eventChainSolving = 1020;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasDragostapeliaScript)("Lua real script Predaplant Dragostapelia counter level negate", () => {
  it("restores targeted Predator Counter placement, Level 1 lock, and chain-solving negate metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragostapeliaCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 69946549, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [dragostapeliaCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const dragostapelia = requireCard(session, dragostapeliaCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, dragostapelia, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    dragostapelia.summonType = "fusion";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dragostapeliaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentLevel(target, session.state)).toBe(4);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === dragostapelia.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: effectFusionMaterial, event: "continuous", property: 0x40400, range: ["monsterZone"], sourceUid: dragostapelia.uid },
      { category: categoryCounter, code: eventFreeChain, event: "quick", property: 0x10, range: ["monsterZone"], sourceUid: dragostapelia.uid },
      { category: undefined, code: eventChainSolving, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: dragostapelia.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === dragostapelia.uid,
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    const restoredTarget = findCard(restored.session, target.uid);
    expect(getDuelCardCounter(restoredTarget, counterPredator)).toBe(1);
    expect(currentLevel(restoredTarget, restored.session.state)).toBe(1);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, event: "continuous", reset: { flags: 0x1fe1000 }, sourceUid: target.uid, value: 1 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "counterAdded")).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragostapelia.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredAgain = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAgain);
    expectRestoredLegalActions(restoredAgain, 0);
    expect(currentLevel(findCard(restoredAgain.session, target.uid), restoredAgain.session.state)).toBe(1);
    expect(restoredAgain.session.state.effects.find((effect) =>
      effect.sourceUid === dragostapelia.uid && effect.code === eventChainSolving && effect.operation
    )).toMatchObject({ code: eventChainSolving, event: "continuous", range: ["monsterZone"] });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: dragostapeliaCode, name: "Predaplant Dragostapelia", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: racePlant, attribute: attributeDark, level: 8, attack: 2700, defense: 1900 },
    { code: targetCode, name: "Dragostapelia Predator Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Predaplant Dragostapelia");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsType,TYPE_FUSION),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_DARK))");
  expect(script).toContain("s.counter_place_list={COUNTER_PREDATOR}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("re:IsMonsterEffect() and re:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
  expect(script).toContain("Duel.NegateEffect(ev)");
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
