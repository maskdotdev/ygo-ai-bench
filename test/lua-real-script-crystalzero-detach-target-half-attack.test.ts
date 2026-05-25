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
const crystalzeroCode = "62070231";
const materialCode = "620702310";
const targetCode = "620702311";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrystalzeroScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crystalzeroCode}.lua`));
const typeMonster = 0x1;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const raceAqua = 0x40;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const effectFlagCardTarget = 16;
const effectFlagDamageStep = 16384;
const effectSetAttackFinal = 102;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasCrystalzeroScript)("Lua real script Crystalzero detach target half attack", () => {
  it("restores Damage Step detach target into final ATK half of current ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${crystalzeroCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 62070231, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [crystalzeroCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const crystalzero = requireCard(session, crystalzeroCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, crystalzero, 0, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    crystalzero.overlayUids.push(material.uid);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crystalzeroCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === crystalzero.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: crystalzero.uid },
      { category: 2097152, code: 1002, event: "quick", property: effectFlagCardTarget | effectFlagDamageStep, range: ["monsterZone"], sourceUid: crystalzero.uid },
    ]);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "declareAttack" && candidate.attackerUid === crystalzero.uid && candidate.targetUid === target.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilEffect(restored, crystalzero.uid);

    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === crystalzero.uid && candidate.effectId === "lua-2-1002",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: crystalzero.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === crystalzero.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === crystalzero.uid), restored.session.state)).toBe(1100);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(2600);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === crystalzero.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { count: 1, flags: resetStandardPhaseEnd }, sourceUid: crystalzero.uid, value: 1100 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "detachedMaterial"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: crystalzero.uid, eventReasonEffectId: 2 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: crystalzero.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === crystalzero.uid), restoredAfter.session.state)).toBe(1100);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === target.uid), restoredAfter.session.state)).toBe(2600);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number 94: Crystalzero");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),5,2)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: crystalzeroCode, name: "Number 94: Crystalzero", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceAqua, attribute: attributeWater, level: 5, attack: 2200, defense: 1600 },
    { code: materialCode, name: "Crystalzero WATER Material", kind: "monster", typeFlags: typeMonster, race: raceAqua, attribute: attributeWater, level: 5, attack: 1400, defense: 1000 },
    { code: targetCode, name: "Crystalzero Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2600, defense: 1000 },
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
