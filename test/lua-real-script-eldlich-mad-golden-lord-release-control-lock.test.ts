import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelEventRecord, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const madLordCode = "74889525";
const zombieCostCode = "748895250";
const opponentTargetCode = "748895251";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMadLordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${madLordCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceZombie = 0x8;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setEldlich = 0x142;
const cardGoldenLord = 95440946;
const categoryControl = 0x2000;
const effectCannotTrigger = 7;
const effectIndestructibleEffect = 41;
const effectIndestructibleBattle = 42;
const effectCannotAttack = 85;
const effectChangeCode = 114;

describe.skipIf(!hasUpstreamScripts || !hasMadLordScript)("Lua real script Eldlich the Mad Golden Lord release control lock", () => {
  it("restores release-cost control take plus Golden Lord code and protection locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${madLordCode}.lua`);
    expectScriptShape(script ?? "");
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 74889525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zombieCostCode], extra: [madLordCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);
    const madLord = requireCard(session, madLordCode);
    const zombieCost = requireCard(session, zombieCostCode);
    const opponent = requireCard(session, opponentTargetCode);
    moveFusionFaceUp(session, madLord, 0, 0);
    moveFaceUpAttack(session, zombieCost, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    prepareMainPhase(session);
    registerMadLord(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === madLord.uid && [effectChangeCode, effectIndestructibleBattle, effectIndestructibleEffect].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeCode, event: "continuous", id: "lua-2-114", property: 0x20000, range: ["monsterZone"], value: cardGoldenLord },
      { code: effectIndestructibleBattle, event: "continuous", id: "lua-3-42", property: 0x20000, range: ["monsterZone"], value: 1 },
      { code: effectIndestructibleEffect, event: "continuous", id: "lua-4-41", property: 0x20000, range: ["monsterZone"], value: 1 },
    ]);
    expect(destroyDuelCard(restoredOpen.session.state, madLord.uid, 0, duelReason.effect | duelReason.destroy, 1)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === madLord.uid && action.effectId === "lua-5");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === zombieCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: madLord.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: madLord.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && [effectCannotAttack, effectCannotTrigger].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectCannotAttack, event: "continuous", property: 0x4000000, reset: { flags: 0x41fc1200 }, sourceUid: opponent.uid },
      { code: effectCannotTrigger, event: "continuous", property: 0x4000000, reset: { flags: 0x41fc1200 }, sourceUid: opponent.uid },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName)).map(eventSummary)).toMatchInlineSnapshot(`
      [
        {
          "current": "graveyard",
          "currentController": 0,
          "eventCardUid": "p0-deck-748895250-0",
          "eventCode": 1017,
          "eventName": "released",
          "eventReason": 130,
          "eventReasonCardUid": "p0-extraDeck-74889525-0",
          "eventReasonEffectId": 5,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 0,
        },
        {
          "current": "graveyard",
          "currentController": 0,
          "eventCardUid": "p0-deck-748895250-0",
          "eventCode": 1014,
          "eventName": "sentToGraveyard",
          "eventReason": 130,
          "eventReasonCardUid": "p0-extraDeck-74889525-0",
          "eventReasonEffectId": 5,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 0,
        },
        {
          "current": "monsterZone",
          "currentController": 1,
          "eventCardUid": "p1-deck-748895251-0",
          "eventCode": 1028,
          "eventName": "becameTarget",
          "eventReason": 0,
          "eventReasonCardUid": undefined,
          "eventReasonEffectId": undefined,
          "eventReasonPlayer": 0,
          "previous": "deck",
          "previousController": 1,
        },
        {
          "current": "monsterZone",
          "currentController": 0,
          "eventCardUid": "p1-deck-748895251-0",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-74889525-0",
          "eventReasonEffectId": 5,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 1,
        },
      ]
    `);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: madLordCode, name: "Eldlich the Mad Golden Lord", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceZombie, attribute: attributeLight, setcodes: [setEldlich], level: 10, attack: 3800, defense: 3500 },
    { code: zombieCostCode, name: "Eldlich Mad Golden Lord Zombie Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 5, attack: 1800, defense: 1500 },
    { code: opponentTargetCode, name: "Eldlich Mad Golden Lord Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1900, defense: 1200 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("--Eldlich the Mad Golden Lord");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_ELDLICH),s.matfilter)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
  expect(script).toContain("e1:SetValue(CARD_GOLDEN_LORD)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e4:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil,dg,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil,dg,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_TRIGGER)");
}

function registerMadLord(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(madLordCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFusionFaceUp(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveFaceUpAttack(session, card, controller, sequence);
  moved.summonType = "fusion";
  markProcedureComplete(moved);
  return moved;
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
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

function eventSummary(event: DuelEventRecord) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
    previousController: event.eventPreviousState?.controller,
    currentController: event.eventCurrentState?.controller,
  };
}
