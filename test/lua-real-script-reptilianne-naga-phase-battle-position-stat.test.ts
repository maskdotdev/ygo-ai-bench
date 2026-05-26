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
const nagaCode = "79491903";
const attackerCode = "794919030";
const idleOpponentCode = "794919031";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNagaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nagaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasNagaScript)("Lua real script Reptilianne Naga phase battle position stat", () => {
  it("restores battled-monster final ATK zero and controller End Phase position change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${nagaCode}.lua`);
    expectNagaScriptShape(script);

    const { reader, session } = createNagaSession();
    const naga = requireCard(session, nagaCode);
    const attacker = requireCard(session, attackerCode);
    const idleOpponent = requireCard(session, idleOpponentCode);
    moveMonster(session, naga, 0, "faceUpDefense", 0);
    moveMonster(session, attacker, 1, "faceUpAttack", 0);
    moveMonster(session, idleOpponent, 1, "faceUpAttack", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nagaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === naga.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 42, countLimit: undefined, event: "continuous", range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: 0x200000, code: 0x1080, countLimit: 1, event: "trigger", range: ["monsterZone"], triggerEvent: "phaseBattle", value: undefined },
      { category: 0x1000, code: 0x1200, countLimit: 1, event: "trigger", range: ["monsterZone"], triggerEvent: "phaseEnd", value: undefined },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === naga.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattle(restoredBattle);

    expect(restoredBattle.session.state.battlePairs).toEqual([{ attackerUid: attacker.uid, targetUid: naga.uid }]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === naga.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpDefense" });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === attacker.uid), restoredBattle.session.state)).toBe(1800);

    const restoredEndBattle = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredEndBattle);
    expectRestoredLegalActions(restoredEndBattle, 1);
    const main2 = getLuaRestoreLegalActions(restoredEndBattle, 1).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredEndBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndBattle, main2!);
    expect(restoredEndBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-4224",
        eventCode: 0x1080,
        eventName: "phaseBattle",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: naga.uid,
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEndBattle.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === naga.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(battleTrigger)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredBattleTrigger, battleTrigger!);
    resolveRestoredChain(restoredBattleTrigger);

    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === attacker.uid), restoredBattleTrigger.session.state)).toBe(0);
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === idleOpponent.uid), restoredBattleTrigger.session.state)).toBe(1700);
    expect(restoredBattleTrigger.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 102, reset: { flags: 33427456 }, value: 0 }]);
    expect(restoredBattleTrigger.session.state.eventHistory.filter((event) => event.eventName === "phaseBattle")).toEqual([{ eventName: "phaseBattle", eventCode: 0x1080 }]);

    const { reader: positionReader, session: positionSession } = createNagaSession();
    const positionNaga = requireCard(positionSession, nagaCode);
    moveMonster(positionSession, positionNaga, 0, "faceUpDefense", 0);
    positionSession.state.phase = "main2";
    positionSession.state.turnPlayer = 0;
    positionSession.state.waitingFor = 0;
    const positionHost = createLuaScriptHost(positionSession, workspace);
    expect(positionHost.loadCardScript(Number(nagaCode), workspace).ok).toBe(true);
    expect(positionHost.registerInitialEffects()).toBe(1);

    const restoredPosition = restoreDuelWithLuaScripts(serializeDuel(positionSession), workspace, positionReader);
    expectCleanRestore(restoredPosition);
    expectRestoredLegalActions(restoredPosition, 0);
    const endPhase = getLuaRestoreLegalActions(restoredPosition, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredPosition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPosition, endPhase!);
    expect(restoredPosition.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-4608",
        eventCode: 0x1200,
        eventName: "phaseEnd",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: positionNaga.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const positionTrigger = getLuaRestoreLegalActions(restoredPosition, 0).find((action) => action.type === "activateTrigger" && action.uid === positionNaga.uid);
    expect(positionTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPosition, 0), null, 2)).toBeDefined();
    expect(positionTrigger).toMatchObject({
      effectId: "lua-3-4608",
      triggerBucket: "turnMandatory",
    });
    applyRestoredActionAndAssert(restoredPosition, positionTrigger!);
    resolveRestoredChain(restoredPosition);

    expect(restoredPosition.session.state.cards.find((card) => card.uid === positionNaga.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack" });
    expect(restoredPosition.session.state.eventHistory.filter((event) => ["phaseEnd", "positionChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventPreviousState: event.eventPreviousState,
      eventCurrentState: event.eventCurrentState,
    }))).toEqual([
      {
        eventName: "phaseEnd",
        eventCode: 0x1200,
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: undefined,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventPreviousState: undefined,
        eventCurrentState: undefined,
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: positionNaga.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: positionNaga.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function createNagaSession(): { reader: ReturnType<typeof createCardReader>; session: DuelSession } {
  const cards: DuelCardData[] = [
    { code: nagaCode, name: "Reptilianne Naga", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 1, attack: 0, defense: 0 },
    { code: attackerCode, name: "Reptilianne Naga Battle Attacker", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: idleOpponentCode, name: "Reptilianne Naga Idle Opponent", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 79491903, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [nagaCode] }, 1: { main: [attackerCode, idleOpponentCode] } });
  startDuel(session);
  return { reader, session };
}

function expectNagaScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("c:GetBattledGroup():IsContains(bc)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil,e:GetHandler())");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e3:SetCategory(CATEGORY_POSITION)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.IsTurnPlayer(tp) and e:GetHandler():IsDefensePos()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.ChangePosition(c,0,0,POS_FACEUP_ATTACK,0)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, position: "faceUpAttack" | "faceUpDefense", sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = position;
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.pendingTriggers.length > 0 || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = (restored.session.state.waitingFor ?? restored.session.state.turnPlayer) as PlayerId;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
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
    const player = (restored.session.state.waitingFor ?? restored.session.state.turnPlayer) as PlayerId;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
