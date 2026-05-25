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
const gaeBulgCode = "900787";
const wingedBeastCostCode = "9007870";
const dragonTunerCode = "9007871";
const wingedBeastMaterialCode = "9007872";
const defenderCode = "9007873";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGaeBulgScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gaeBulgCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const raceWingedBeast = 0x200;
const attributeWind = 0x10;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const resetStandardDisablePhaseEnd = 0x41ff1200;

describe.skipIf(!hasUpstreamScripts || !hasGaeBulgScript)("Lua real script Dragunity Knight Gae Bulg banish cost battle stat", () => {
  it("restores Damage Step Winged Beast banish cost into self ATK gain and once-per-damage flag", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${gaeBulgCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 900787, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wingedBeastCostCode, dragonTunerCode, wingedBeastMaterialCode], extra: [gaeBulgCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const gaeBulg = requireCard(session, gaeBulgCode);
    const wingedBeastCost = requireCard(session, wingedBeastCostCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, gaeBulg, 0, 0);
    moveDuelCard(session.state, wingedBeastCost.uid, "graveyard", 0);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gaeBulgCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(gaeBulg.data).toMatchObject({
      synchroNonTunerMax: 99,
      synchroNonTunerMin: 1,
      synchroNonTunerRace: raceWingedBeast,
      synchroTunerMax: 1,
      synchroTunerMin: 1,
      synchroTunerRace: raceDragon,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === gaeBulg.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilDamageResponse(restored, 0);

    const boost = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gaeBulg.uid && action.effectId === "lua-3-1002"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, boost!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === wingedBeastCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: gaeBulg.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === gaeBulg.uid), restored.session.state)).toBe(3300);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gaeBulg.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: gaeBulg.uid, value: 1300 },
    ]);
    expect(restored.session.state.flagEffects.filter((flag) => flag.ownerId === gaeBulg.uid && flag.code === Number(gaeBulgCode)).map((flag) => ({
      code: flag.code,
      ownerId: flag.ownerId,
      ownerType: flag.ownerType,
      reset: flag.reset,
      value: flag.value,
    }))).toEqual([
      { code: Number(gaeBulgCode), ownerId: gaeBulg.uid, ownerType: "card", reset: 1073741856, value: 0 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "attackDeclared", eventCardUid: gaeBulg.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "banished", eventCardUid: wingedBeastCost.uid, eventReason: duelReason.cost, eventReasonCardUid: gaeBulg.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === gaeBulg.uid), restoredAfter.session.state)).toBe(3300);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dragunity Knight - Gae Bulg");
  expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_DRAGON),1,1,Synchro.NonTunerEx(Card.IsRace,RACE_WINGEDBEAST),1,99)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("local ph=Duel.GetCurrentPhase()");
  expect(script).toContain("return ph==PHASE_DAMAGE and (c==Duel.GetAttacker() or c==Duel.GetAttackTarget())");
  expect(script).toContain("return c:IsRace(RACE_WINGEDBEAST) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetAttack())");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE,0,1)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
}

function cards(): DuelCardData[] {
  return [
    { code: gaeBulgCode, name: "Dragunity Knight - Gae Bulg", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceDragon, attribute: attributeWind, level: 6, attack: 2000, defense: 1100 },
    { code: wingedBeastCostCode, name: "Gae Bulg Winged Beast Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1300, defense: 800 },
    { code: dragonTunerCode, name: "Gae Bulg Dragon Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceDragon, attribute: attributeWind, level: 2, attack: 800, defense: 400 },
    { code: wingedBeastMaterialCode, name: "Gae Bulg Winged Beast Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
    { code: defenderCode, name: "Gae Bulg Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function passUntilDamageResponse(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.waitingFor !== player || restored.session.state.battleStep !== "damage" || restored.session.state.battleWindow?.kind !== "beforeDamageCalculation") {
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
