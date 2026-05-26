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
const pedalCode = "27275398";
const goldPrideCode = "272753980";
const destroyedGoldPrideCode = "272753981";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPedalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pedalCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const setGoldPride = 0x193;
const raceWarrior = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasPedalScript)("Lua real script Gold Pride Pedal stat end set", () => {
  it("restores targeted Gold Pride ATK/protection/cannot-trigger effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${pedalCode}.lua`));
    const reader = createCardReader(cards());
    const session = createPedalSession(reader, workspace);
    const pedal = requireCard(session, pedalCode);
    const target = requireCard(session, goldPrideCode);
    moveFaceDownSpell(session, pedal);
    moveFaceUpAttack(session, target, 0);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === pedal.uid && action.effectId === "lua-1-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2300);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [7, 41, 42, 100].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 500 },
      { code: 42, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1 },
      { code: 41, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1 },
      { code: 7, property: 0x4000000, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 500 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(2300);
  });

  it("restores GlobalCheck destroyed Gold Pride flag into End Phase Graveyard self-Set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${pedalCode}.lua`));
    const reader = createCardReader(cards());
    const session = createPedalSession(reader, workspace);
    const pedal = requireCard(session, pedalCode);
    const destroyedGoldPride = requireCard(session, destroyedGoldPrideCode);
    moveDuelCard(session.state, pedal.uid, "graveyard", 0);
    moveFaceUpAttack(session, destroyedGoldPride, 0);

    const destroy = createLuaScriptHost(session, workspace).loadScript(
      `
        local g=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${destroyedGoldPrideCode}),0,LOCATION_MZONE,0,1,1,nil)
        Duel.Destroy(g,REASON_EFFECT)
        Debug.Message("gold pride destroyed for pedal flag")
      `,
      "gold-pride-pedal-destroy.lua",
    );
    expect(destroy.ok, destroy.error).toBe(true);

    const restoredMain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMain);
    restoredMain.session.state.phase = "main2";
    restoredMain.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredMain, 0);
    const endPhase = getLuaRestoreLegalActions(restoredMain, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain, endPhase!);

    expect(restoredMain.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: 0x1200 }]);
    expectRestoredLegalActions(restoredMain, 0);
    const setTrigger = getLuaRestoreLegalActions(restoredMain, 0).find((action) => action.type === "activateTrigger" && action.uid === pedal.uid);
    expect(setTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain, setTrigger!);
    resolveRestoredChain(restoredMain);

    expect(restoredMain.session.state.cards.find((card) => card.uid === pedal.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredMain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === destroyedGoldPride.uid).map((event) => ({
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
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedGoldPride.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
    expect(restoredMain.session.state.eventHistory.filter((event) => event.eventName === "spellTrapSet" && event.eventCardUid === pedal.uid)).toEqual([
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: pedal.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredMain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("Duel.RegisterFlagEffect(tc:GetPreviousControler(),id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.HasFlagEffect(tp,id)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_GOLD_PRIDE),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e4:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,c,1,0,0)");
  expect(script).toContain("Duel.SSet(tp,c)");
}

function cards(): DuelCardData[] {
  return [
    { code: pedalCode, name: "Gold Pride - Pedal to the Metal!", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: goldPrideCode, name: "Gold Pride Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGoldPride], race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1200 },
    { code: destroyedGoldPrideCode, name: "Destroyed Gold Pride", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGoldPride], race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
  ];
}

function createPedalSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): DuelSession {
  const session = createDuel({ seed: 27275398, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pedalCode, goldPrideCode, destroyedGoldPrideCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pedalCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
