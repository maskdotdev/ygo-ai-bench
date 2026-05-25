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
const supraCode = "96864105";
const abyssSplashCode = "36076683";
const defenderCode = "968641050";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSupraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${supraCode}.lua`));
const typeMonster = 0x1;
const typeXyz = 0x800000;
const raceSeaSerpent = 0x40000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const effectIndestructibleEffect = 41;

describe.skipIf(!hasUpstreamScripts || !hasSupraScript)("Lua real script Abyss Supra Splash detach battle stat", () => {
  it("restores overlay-code protection and pre-damage detach ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${supraCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 96864105, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [abyssSplashCode], extra: [supraCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const supra = requireCard(session, supraCode);
    const material = requireCard(session, abyssSplashCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, supra, 0, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    supra.overlayUids.push(material.uid);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(supraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(supra.data).toMatchObject({ xyzMaterialCount: 3 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === supra.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", id: "lua-1-31", luaConditionDescriptor: undefined, property: 263168, range: ["monsterZone"], sourceUid: supra.uid, value: undefined },
      { code: 1134, event: "quick", id: "lua-2-1134", luaConditionDescriptor: undefined, property: undefined, range: ["monsterZone"], sourceUid: supra.uid, value: undefined },
      { code: effectIndestructibleEffect, event: "continuous", id: "lua-3-41", luaConditionDescriptor: undefined, property: 0x20000, range: ["monsterZone"], sourceUid: supra.uid, value: 1 },
    ]);

    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === supra.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilDamageResponse(restored, 0);

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === supra.uid && action.effectId === "lua-2-1134"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === supra.uid)?.overlayUids).toEqual([]);
    expect(findCard(restored.session, material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: supra.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, supra.uid)).toMatchObject({ attackModifier: 2100 });
    expect(currentAttack(findCard(restored.session, supra.uid), restored.session.state)).toBe(5100);
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "detachedMaterial"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: supra.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: material.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: supra.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "overlay", relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number C73: Abyss Supra Splash");
  expect(script).toContain("Xyz.AddProcedure(c,nil,6,3)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetCost(Cost.AND(Cost.DetachFromSelf(1),Cost.SoftOncePerBattle(id)))");
  expect(script).toContain("local bc1,bc2=Duel.GetBattleMonster(tp)");
  expect(script).toContain("bc1:UpdateAttack(bc2:GetAttack(),RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL,e:GetHandler())");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e:GetHandler():GetOverlayGroup():IsExists(Card.IsCode,1,nil,36076683)");
}

function cards(): DuelCardData[] {
  return [
    { code: supraCode, name: "Number C73: Abyss Supra Splash", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceSeaSerpent, attribute: attributeWater, level: 6, attack: 3000, defense: 2000 },
    { code: abyssSplashCode, name: "Number 73: Abyss Splash", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceSeaSerpent, attribute: attributeWater, level: 5, attack: 2400, defense: 1400 },
    { code: defenderCode, name: "Abyss Supra Splash Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2100, defense: 1000 },
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

function passUntilDamageResponse(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.waitingFor !== player || restored.session.state.battleWindow?.kind !== "beforeDamageCalculation") {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
