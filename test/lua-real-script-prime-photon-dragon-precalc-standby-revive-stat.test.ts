import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const primeCode = "31801517";
const materialCode = "318015170";
const galaxyEyesPhotonCode = "93717133";
const defenderCode = "318015171";
const opponentXyzCode = "318015172";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPrimeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${primeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const attributeLight = 0x10;
const raceDragon = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasPrimeScript)("Lua real script Prime Photon Dragon precalc standby revive stat", () => {
  it("restores pre-damage Rank ATK gain, half battle damage, and delayed Standby self-revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${primeCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,8,2)");
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e1:SetCost(Cost.AND(Cost.DetachFromSelf(1),Cost.SoftOncePerBattle(id)))");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil):GetSum(Card.GetRank)");
    expect(script).toContain("c:UpdateAttack(rks*200,RESET_EVENT|RESETS_STANDARD_DISABLE|RESET_PHASE|PHASE_DAMAGE_CAL)");
    expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("c:GetOverlayGroup():IsExists(Card.IsCode,1,nil,CARD_GALAXYEYES_P_DRAGON)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_STANDBY)");
    expect(script).toContain("c:SetTurnCounter(0)");
    expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
    expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
    expect(script).toContain("e3:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
    expect(script).toContain("e3:SetValue(aux.ChangeBattleDamage(1,HALF_DAMAGE))");

    const reader = createCardReader(cards());
    const restoredBattle = createRestoredPrimeField({ reader, workspace, includeGalaxyMaterial: false, phase: "battle" });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const prime = requireCard(restoredBattle.session, primeCode);
    const material = requireCard(restoredBattle.session, materialCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === prime.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      registryKey: effect.registryKey,
    }))).toEqual([
      { code: 31, event: "continuous", id: "lua-1-31", range: ["monsterZone"], registryKey: `lua:${primeCode}:lua-1-31` },
      { code: 1134, event: "quick", id: "lua-2-1134", range: ["monsterZone"], registryKey: `lua:${primeCode}:lua-2-1134` },
      { code: 1029, event: "trigger", id: "lua-3-1029", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], registryKey: `lua:${primeCode}:lua-3-1029` },
      { code: 208, event: "continuous", id: "lua-4-208", range: ["monsterZone"], registryKey: `lua:${primeCode}:lua-4-208` },
    ]);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === prime.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilEffect(restoredBattle, prime.uid);
    const effectPlayer = restoredBattle.session.state.waitingFor ?? restoredBattle.session.state.turnPlayer;
    const attackGain = getLuaRestoreLegalActions(restoredBattle, effectPlayer).find((action) =>
      action.type === "activateEffect" && action.uid === prime.uid
    );
    expect(attackGain, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attackGain!);
    resolveRestoredChain(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === prime.uid)?.overlayUids).toEqual([]);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: prime.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === prime.uid), restoredBattle.session.state)).toBe(6400);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === prime.uid)).toMatchObject({ attackModifier: 2400 });
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === prime.uid && effect.code === 208).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      sourceUid: effect.sourceUid,
    }))).toEqual([{ code: 208, registryKey: `lua:${primeCode}:lua-4-208`, sourceUid: prime.uid }]);
    passBattleUntilComplete(restoredBattle);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(2700);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(5300);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["detachedMaterial", "battleDamageDealt"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2 },
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: prime.uid, eventPlayer: 1, eventValue: 2700, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: undefined },
    ]);

    const restoredDestroyed = createRestoredPrimeField({ reader, workspace, includeGalaxyMaterial: true, phase: "main1" });
    const destroyedPrime = requireCard(restoredDestroyed.session, primeCode);
    destroyDuelCard(restoredDestroyed.session.state, destroyedPrime.uid, 0, duelReason.effect | duelReason.destroy, 1);
    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyedPrime.uid && action.effectId === "lua-3-1029"
    );
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyedTrigger, destroyedTrigger!);
    resolveRestoredChain(restoredDestroyedTrigger);
    const standbyWatcher = restoredDestroyedTrigger.session.state.effects.find((effect) => effect.sourceUid === destroyedPrime.uid && effect.code === 0x1002);
    expect(standbyWatcher, JSON.stringify(restoredDestroyedTrigger.session.state.effects.filter((effect) => effect.sourceUid === destroyedPrime.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      triggerCode: effect.triggerCode,
      triggerEvent: effect.triggerEvent,
    })), null, 2)).toMatchObject({
      code: 0x1002,
      event: "continuous",
      id: "lua-5-4098",
      registryKey: `lua:${primeCode}:lua-5-4098`,
      reset: { count: 2, flags: 1375604738 },
      sourceUid: destroyedPrime.uid,
    });
    const restoredStandbyWatcher = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyedTrigger.session), workspace, reader);
    expectCleanRestore(restoredStandbyWatcher);
    const restoredWatcher = restoredStandbyWatcher.session.state.effects.find((effect) => effect.sourceUid === destroyedPrime.uid && effect.code === 0x1002);
    expect(restoredWatcher).toMatchObject({
      code: 0x1002,
      event: "continuous",
      id: "lua-5-4098",
      registryKey: `lua:${primeCode}:lua-5-4098`,
      reset: { count: 2, flags: 1375604738 },
      sourceUid: destroyedPrime.uid,
      triggerCode: 0x1002,
      triggerEvent: "phaseStandby",
    });
    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === destroyedPrime.uid)).toMatchObject({
      location: "graveyard",
      turnCounter: 0,
    });

    advanceOwnStandby(restoredStandbyWatcher);
    expect(restoredStandbyWatcher.session.state.cards.find((card) => card.uid === destroyedPrime.uid)).toMatchObject({
      location: "graveyard",
      turnCounter: 1,
    });
    expect(restoredStandbyWatcher.session.state.effects.some((effect) => effect.sourceUid === destroyedPrime.uid && effect.code === 0x1002)).toBe(true);
    advanceOwnStandby(restoredStandbyWatcher);
    expect(restoredStandbyWatcher.session.state.cards.find((card) => card.uid === destroyedPrime.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedPrime.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredStandbyWatcher.session.state.cards.find((card) => card.uid === destroyedPrime.uid), restoredStandbyWatcher.session.state)).toBe(8000);
    expect(restoredStandbyWatcher.session.state.effects.filter((effect) => effect.sourceUid === destroyedPrime.uid && effect.code === 101).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 101, reset: { flags: 33427456 }, value: 8000 }]);
    expect(restoredStandbyWatcher.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: destroyedPrime.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: destroyedPrime.uid, eventReasonEffectId: 5 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: primeCode, name: "Number 62: Galaxy-Eyes Prime Photon Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeLight, level: 8, attack: 4000, defense: 3000, xyzMaterialCount: 2 },
    { code: materialCode, name: "Prime Photon Generic Material", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeLight, level: 8, attack: 1000, defense: 1000 },
    { code: galaxyEyesPhotonCode, name: "Galaxy-Eyes Photon Dragon", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: defenderCode, name: "Prime Photon Battle Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentXyzCode, name: "Opponent Rank Four Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2000, defense: 1000, xyzMaterialCount: 2 },
  ];
}

function createRestoredPrimeField({
  reader,
  workspace,
  includeGalaxyMaterial,
  phase,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  includeGalaxyMaterial: boolean;
  phase: DuelSession["state"]["phase"];
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const material = includeGalaxyMaterial ? galaxyEyesPhotonCode : materialCode;
  const session = createDuel({ seed: includeGalaxyMaterial ? 31801518 : 31801517, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [material], extra: [primeCode] }, 1: { main: [defenderCode], extra: [opponentXyzCode] } });
  startDuel(session);
  const prime = requireCard(session, primeCode);
  const xyzMaterial = requireCard(session, material);
  const opponentXyz = requireCard(session, opponentXyzCode, 1);
  moveFaceUpAttack(session, prime, 0, 0);
  prime.summonType = "xyz";
  prime.summonTypeCode = luaSummonTypeXyz;
  moveDuelCard(session.state, xyzMaterial.uid, "overlay", 0);
  prime.overlayUids.push(xyzMaterial.uid);
  moveFaceUpAttack(session, requireCard(session, defenderCode, 1), 1, 0);
  moveFaceUpAttack(session, opponentXyz, 1, 1);
  opponentXyz.summonType = "xyz";
  opponentXyz.summonTypeCode = luaSummonTypeXyz;
  session.state.phase = phase;
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(primeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string, owner?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (owner === undefined || candidate.owner === owner));
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

function passUntilEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer).some((action) => action.type === "activateEffect" && action.uid === uid)) {
    const actingPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expect(++guard, JSON.stringify({
      battleStep: restored.session.state.battleStep,
      pendingBattle: restored.session.state.pendingBattle,
      waitingFor: restored.session.state.waitingFor,
      actions: getLuaRestoreLegalActions(restored, actingPlayer),
    }, null, 2)).toBeLessThan(10);
    const pass = getLuaRestoreLegalActions(restored, actingPlayer).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actingPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
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

function advanceOwnStandby(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  restored.session.state.turn += 2;
  restored.session.state.turnPlayer = 0;
  restored.session.state.phase = "draw";
  restored.session.state.waitingFor = 0;
  const standby = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
  expect(standby, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, standby!);
}
