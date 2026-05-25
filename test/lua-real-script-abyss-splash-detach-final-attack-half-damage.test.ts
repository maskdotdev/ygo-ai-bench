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
const abyssCode = "36076683";
const materialCode = "360766830";
const defenderCode = "360766831";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAbyssScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abyssCode}.lua`));
const typeMonster = 0x1;
const typeXyz = 0x800000;
const raceSeaSerpent = 0x40000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const effectChangeBattleDamage = 208;
const resetStandardDisablePhaseEndOpponentTurn = 1644106240;
const resetStandardDisablePhaseEnd = 1107235328;

describe.skipIf(!hasUpstreamScripts || !hasAbyssScript)("Lua real script Abyss Splash detach final attack half damage", () => {
  it("restores Damage Step detach into doubled final ATK and half battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${abyssCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 36076683, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [abyssCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const abyss = requireCard(session, abyssCode);
    const material = requireCard(session, materialCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, abyss, 0, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    abyss.overlayUids.push(material.uid);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(abyssCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === abyss.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: abyss.uid },
      { category: 2097152, code: 1002, event: "quick", property: 16384, range: ["monsterZone"], sourceUid: abyss.uid },
    ]);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "declareAttack" && candidate.attackerUid === abyss.uid && candidate.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilEffect(restored, abyss.uid);

    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === abyss.uid && candidate.effectId === "lua-2-1002",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: abyss.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === abyss.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === abyss.uid), restored.session.state)).toBe(4800);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === abyss.uid && [effectSetAttackFinal, effectChangeBattleDamage].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: undefined, reset: { flags: resetStandardDisablePhaseEndOpponentTurn }, sourceUid: abyss.uid, value: 4800 },
      { code: effectChangeBattleDamage, event: "continuous", property: undefined, reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: abyss.uid, value: undefined },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: abyss.uid, eventReasonEffectId: 2 },
    ]);

    passBattleUntilComplete(restored);
    expect(restored.session.state.battleDamage[1]).toBe(1650);
    expect(restored.session.state.players[1].lifePoints).toBe(6350);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number 73: Abyss Splash");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),5,2)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END|RESET_OPPO_TURN)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
  expect(script).toContain("e2:SetValue(aux.ChangeBattleDamage(1,HALF_DAMAGE))");
}

function cards(): DuelCardData[] {
  return [
    { code: abyssCode, name: "Number 73: Abyss Splash", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceSeaSerpent, attribute: attributeWater, level: 5, attack: 2400, defense: 1400 },
    { code: materialCode, name: "Abyss Splash WATER Material", kind: "monster", typeFlags: typeMonster, race: raceSeaSerpent, attribute: attributeWater, level: 5, attack: 1600, defense: 1000 },
    { code: defenderCode, name: "Abyss Splash Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
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

function passUntilEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer).some((action) =>
    action.type === "activateEffect" && action.uid === uid
  )) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.battleStep !== undefined) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
