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
const fractureCode = "43215738";
const mementoCode = "432157380";
const tecuhtlicaCode = "23288411";
const firstTargetCode = "432157381";
const secondTargetCode = "432157382";
const opponentAttackTargetCode = "432157383";
const opponentAttackTargetBCode = "432157384";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFractureScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fractureCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setMemento = 0x19a;
const raceFiend = 0x8;
const attributeDark = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasFractureScript)("Lua real script Mementotlan Fracture Dance destroy attack stat", () => {
  it("restores targeted destroy with optional BreakEffect destroy and graveyard attack-announce ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fractureCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCondition(function(_,tp) return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_MEMENTO),tp,LOCATION_MZONE,0,1,nil) end)");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("Duel.GetMatchingGroup(nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_MEMENTOAL_TECUHTLICA),tp,LOCATION_ONFIELD,0,1,nil)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.HintSelection(dg,true)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("local yc,oc=Duel.GetBattleMonster(tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,#g,1-tp,-1000)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-1000)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 43215738, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [fractureCode, mementoCode, tecuhtlicaCode, secondTargetCode] },
      1: { main: [firstTargetCode, opponentAttackTargetCode, opponentAttackTargetBCode] },
    });
    startDuel(session);
    const fracture = requireCard(session, fractureCode);
    const memento = requireCard(session, mementoCode);
    const tecuhtlica = requireCard(session, tecuhtlicaCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    const opponentAttackTarget = requireCard(session, opponentAttackTargetCode);
    const opponentAttackTargetB = requireCard(session, opponentAttackTargetBCode);
    const movedFracture = moveDuelCard(session.state, fracture.uid, "spellTrapZone", 0);
    movedFracture.position = "faceDown";
    movedFracture.faceUp = false;
    movedFracture.turnId = 0;
    moveFaceUpAttack(session, memento, 0, 0);
    moveFaceUpAttack(session, tecuhtlica, 0, 1);
    moveFaceUpSpell(session, secondTarget, 0, 1);
    moveFaceUpSpell(session, firstTarget, 1, 0);
    moveFaceUpAttack(session, opponentAttackTarget, 1, 0);
    moveFaceUpAttack(session, opponentAttackTargetB, 1, 1);
    session.state.phase = "main1";
    session.state.turn = 1;
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fractureCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fracture.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(activate)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredOpen, activate!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions.map((decision) => ({
      api: decision.api,
      player: decision.player,
      returned: decision.returned,
    }))).toEqual([
      { api: "SelectYesNo", player: 0, returned: true },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fracture.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === memento.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fracture.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tecuhtlica.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fracture.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === secondTarget.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: memento.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: memento.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: fracture.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fracture.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: tecuhtlica.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: fracture.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    const movedMemento = moveDuelCard(restoredBattle.session.state, memento.uid, "monsterZone", 0);
    movedMemento.faceUp = true;
    movedMemento.position = "faceUpAttack";
    movedMemento.reason = duelReason.rule;
    delete movedMemento.reasonCardUid;
    delete movedMemento.reasonEffectId;
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === memento.uid && action.targetUid === opponentAttackTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1130", eventCardUid: memento.uid, eventCode: 1130, eventName: "attackDeclared", eventPlayer: 0, eventReason: duelReason.rule, eventReasonPlayer: 0, player: 0, sourceUid: fracture.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === fracture.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(trigger)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === fracture.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: fracture.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentAttackTarget.uid), restoredTrigger.session.state)).toBe(800);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentAttackTargetB.uid), restoredTrigger.session.state)).toBe(600);
    expect(restoredTrigger.session.state.effects.filter((effect) => [opponentAttackTarget.uid, opponentAttackTargetB.uid].includes(effect.sourceUid ?? "") && effect.code === 100).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: opponentAttackTarget.uid, code: 100, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, value: -1000 },
      { sourceUid: opponentAttackTargetB.uid, code: 100, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, value: -1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: memento.uid, eventPlayer: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "graveyard", currentLocation: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: fracture.uid, eventPlayer: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: fracture.uid, eventReasonEffectId: 2, previousLocation: "graveyard", currentLocation: "banished" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: fractureCode, name: "Mementotlan Fracture Dance", kind: "trap", typeFlags: typeTrap },
    { code: mementoCode, name: "Mementotlan Fixture Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 2000, defense: 1000, setcodes: [setMemento] },
    { code: tecuhtlicaCode, name: "Mementotlan Tecuhtlica", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 11, attack: 5000, defense: 5000, setcodes: [setMemento] },
    { code: firstTargetCode, name: "Mementotlan First Destroy Target", kind: "trap", typeFlags: typeTrap },
    { code: secondTargetCode, name: "Mementotlan Optional Destroy Target", kind: "trap", typeFlags: typeTrap },
    { code: opponentAttackTargetCode, name: "Mementotlan Attack Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
    { code: opponentAttackTargetBCode, name: "Mementotlan Attack Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence?: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  if (sequence !== undefined) moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence?: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  if (sequence !== undefined) moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
