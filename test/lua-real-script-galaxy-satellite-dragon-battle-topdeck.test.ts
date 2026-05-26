import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const satelliteCode = "92362073";
const numberXyzCode = "923620730";
const topdeckCode = "923620731";
const deckDecoyCode = "923620732";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSatelliteScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${satelliteCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typeLink = 0x4000000;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const setNumber = 0x48;
const effectSetAttackFinal = 102;
const effectChangeBattleDamage = 208;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasSatelliteScript)("Lua real script Galaxy Satellite Dragon battle topdeck", () => {
  it("restores grave battle quick self-banish stat and opponent End Phase topdeck confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const source = scriptSource(workspace);
    expectScriptShape(workspace.readScript(`official/c${satelliteCode}.lua`));
    const reader = createCardReader(cards());

    const battle = createRestoredBattleScenario({ reader, source, workspace });
    expectCleanRestore(battle);
    expectRestoredLegalActions(battle, 0);
    const satellite = requireCard(battle.session, satelliteCode);
    const numberXyz = requireCard(battle.session, numberXyzCode);
    const attack = getLuaRestoreLegalActions(battle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === numberXyz.uid && action.directAttack
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(battle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(battle, attack!);
    passRestoredBattleAction(battle, 1, "passAttack");
    passRestoredBattleAction(battle, 0, "passAttack");
    passRestoredBattleAction(battle, 1, "passDamage");
    const quick = getLuaRestoreLegalActions(battle, 0).find((action) =>
      action.type === "activateEffect" && action.uid === satellite.uid
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(battle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(battle, quick!);
    resolveRestoredChain(battle);

    expect(battle.session.state.cards.find((card) => card.uid === satellite.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: satellite.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(battle.session.state.cards.find((card) => card.uid === numberXyz.uid), battle.session.state)).toBe(6200);
    expect(battle.session.state.effects.filter((effect) =>
      (effect.sourceUid === numberXyz.uid && effect.code === effectSetAttackFinal) ||
      (effect.sourceUid === satellite.uid && effect.code === effectChangeBattleDamage)
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeBattleDamage, property: 2048, reset: { flags: 1073741952 }, sourceUid: satellite.uid, targetRange: [0, 1], value: 2147483649 },
      { code: effectSetAttackFinal, property: undefined, reset: { count: 1, flags: 1107169408 }, sourceUid: numberXyz.uid, targetRange: undefined, value: 6200 },
    ]);
    expect(battle.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: satellite.uid, eventReason: duelReason.cost, eventReasonCardUid: satellite.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: numberXyz.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
    ]);

    const endPhase = createRestoredEndPhaseScenario({ reader, source, workspace });
    expectCleanRestore(endPhase);
    const endSatellite = requireCard(endPhase.session, satelliteCode);
    const topdeck = requireCard(endPhase.session, topdeckCode);
    const decoy = requireCard(endPhase.session, deckDecoyCode);
    changePhase(endPhase.session, 1, "end");

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(endPhase.session), source, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    expect(restoredEnd.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-4608", eventCode: phaseEndEventCode, eventName: "phaseEnd", player: 0, sourceUid: endSatellite.uid, triggerBucket: "opponentOptional" },
    ]);
    const endTrigger = getLuaRestoreLegalActions(restoredEnd, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === endSatellite.uid
    );
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endTrigger!);
    resolveRestoredChain(restoredEnd);

    expect(restoredEnd.host.messages).toContain(`confirmed decktop 0: ${topdeckCode}`);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === topdeck.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 0 });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredEnd.session.state.eventHistory.filter((event) => ["phaseEnd", "confirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventUids: event.eventUids,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventName: "phaseEnd", eventCode: phaseEndEventCode, eventCardUid: undefined, eventPlayer: undefined, eventUids: undefined, eventValue: undefined },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: topdeck.uid, eventPlayer: 0, eventUids: [topdeck.uid], eventValue: 1 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: satelliteCode, name: "Galaxy Satellite Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceDragon, attribute: attributeLight, level: 2, attack: 2000, defense: 0 },
    { code: numberXyzCode, name: "Number 62: Galaxy-Eyes Prime Photon Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeLight, setcodes: [setNumber], level: 8, attack: 4000, defense: 3000 },
    { code: topdeckCode, name: "Galaxy Satellite Topdeck", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: deckDecoyCode, name: "Galaxy Satellite Deck Decoy", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
  ];
}

function scriptSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${numberXyzCode}.lua`) return `c${numberXyzCode}={xyz_number=62}`;
      return workspace.readScript(name);
    },
  };
}

function createRestoredBattleScenario(
  { reader, source, workspace }: { reader: ReturnType<typeof createCardReader>; source: ReturnType<typeof scriptSource>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 92362073, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [satelliteCode, numberXyzCode] }, 1: { main: [] } });
  startDuel(session);
  const satellite = requireCard(session, satelliteCode);
  const numberXyz = requireCard(session, numberXyzCode);
  moveDuelCard(session.state, satellite.uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, numberXyz, 0, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(satelliteCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(numberXyzCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredEndPhaseScenario(
  { reader, source, workspace }: { reader: ReturnType<typeof createCardReader>; source: ReturnType<typeof scriptSource>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 92362074, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [topdeckCode, deckDecoyCode], extra: [satelliteCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, satelliteCode), 0, 0);
  requireCard(session, topdeckCode).sequence = 0;
  requireCard(session, deckDecoyCode).sequence = 1;
  session.state.phase = "main2";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(satelliteCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Galaxy Satellite Dragon");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_DRAGON),2,2)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
  expect(script).toContain("local ph=Duel.GetCurrentPhase()");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
  expect(script).toContain("e1:SetValue(HALF_DAMAGE)");
  expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,2),PHASE_BATTLE)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e3:SetValue(m.xyz_number*100)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.TRUE,tp,LOCATION_DECK,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.ShuffleDeck(tp)");
  expect(script).toContain("Duel.MoveSequence(tc,0)");
  expect(script).toContain("Duel.ConfirmDecktop(tp,1)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function changePhase(session: DuelSession, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLegalActions(session, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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
