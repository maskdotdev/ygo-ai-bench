import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const utopicFutureCode = "65305468";
const targetCode = "653054681";
const materialACode = "653054682";
const materialBCode = "653054683";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUtopicFutureScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${utopicFutureCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUtopicFutureScript)("Lua real script Number F0 Utopic Future damage step control replace", () => {
  it("restores battle damage prevention, Damage Step End control, and detach destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${utopicFutureCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 65305468, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [utopicFutureCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const future = requireCard(session, utopicFutureCode);
    const target = requireCard(session, targetCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    moveFaceUpAttack(session, future, 0);
    future.summonType = "xyz";
    attachOverlay(session, future, materialA, materialB);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(utopicFutureCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === future.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 42, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: 200, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 201, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: 0x2000, code: 1141, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "damageStepEnded", value: undefined },
      { category: undefined, code: 50, event: "continuous", property: 0x20000, range: ["monsterZone"], triggerEvent: "customEvent", value: undefined },
    ]);

    attackAndReachDamageEnd(restoredOpen, 0, future.uid, target.uid);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-5-1141",
        sourceUid: future.uid,
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: future.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [future.uid, target.uid],
        eventTriggerTiming: "when",
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const takeControl = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === future.uid);
    expect(takeControl, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, takeControl!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: future.uid,
      reasonEffectId: 5,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["damageStepEnded", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: future.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: future.uid, eventReasonEffectId: 5, previousController: 1, currentController: 0 },
    ]);

    const restoredBeforeReplacement = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectEffectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredBeforeReplacement);
    expectRestoredLegalActions(restoredBeforeReplacement, 0);
    const replaced = destroyDuelCard(restoredBeforeReplacement.session.state, future.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(replaced).toMatchObject({ uid: future.uid, location: "monsterZone", overlayUids: [materialB.uid] });
    expect(restoredBeforeReplacement.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true });
    expect(restoredBeforeReplacement.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: future.uid,
      reasonEffectId: 6,
    });
    expect(restoredBeforeReplacement.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: future.uid, eventReasonEffectId: 6, previousLocation: "overlay", currentLocation: "graveyard" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number F0: Utopic Future");
  expect(script).toContain("Xyz.AddProcedure(c,s.xyzfilter,nil,2,nil,nil,nil,nil,false,s.xyzcheck)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e4:SetCode(EFFECT_NO_BATTLE_DAMAGE)");
  expect(script).toContain("e5:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e6:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("e7:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("EFFECT_EQUIP_SPELL_XYZ_MAT");
  expect(script).toContain("Card.GetRank");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_BATTLE,1)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
  expect(script).toContain("c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: utopicFutureCode, name: "Number F0: Utopic Future", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 1, attack: 0, defense: 0 },
    { code: targetCode, name: "Utopic Future Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: materialACode, name: "Utopic Future Material A", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 1200, defense: 1000 },
    { code: materialBCode, name: "Utopic Future Material B", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 1300, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function attachOverlay(session: DuelSession, holder: DuelCardInstance, ...materials: DuelCardInstance[]): void {
  for (const [sequence, material] of materials.entries()) {
    moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller).sequence = sequence;
    holder.overlayUids.push(material.uid);
  }
}

function attackAndReachDamageEnd(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  passRestoredUntilPendingTrigger(restored);
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

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
