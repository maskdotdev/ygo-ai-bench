import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const lightRulerCode = "5861892";
const materialACode = "58618920";
const materialBCode = "58618921";
const materialCCode = "58618922";
const hasLightRulerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lightRulerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categoryDisable = 0x10000000;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLightRulerScript)("Lua real script Arcana Force EX Light Ruler procedure coin", () => {
  it("restores SelectUnselectGroup special summon procedure into Arcana coin registration", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lightRulerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 151, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lightRulerCode, materialACode, materialBCode, materialCCode] }, 1: { main: [] } });
    startDuel(session);

    const lightRuler = requireCard(session, lightRulerCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const materialC = requireCard(session, materialCCode);
    moveDuelCard(session.state, lightRuler.uid, "hand", 0);
    moveFaceUpAttack(session, materialA, 0, 0);
    moveFaceUpAttack(session, materialB, 0, 1);
    moveFaceUpAttack(session, materialC, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lightRulerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === lightRuler.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 34, event: "summonProcedure", property: 262144, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 30, event: "continuous", property: 263168, range: ["hand"], triggerEvent: undefined },
      { category: categoryCoin, code: 1102, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: undefined, code: 3682106, event: "continuous", property: 132096, range: ["monsterZone"], triggerEvent: undefined },
    ]);

    const procedure = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === lightRuler.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, procedure!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === lightRuler.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    for (const material of [materialA, materialB, materialC]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: lightRuler.uid,
      });
    }
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-4-1102",
        sourceUid: lightRuler.uid,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: lightRuler.uid,
        eventPlayer: 0,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === lightRuler.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === lightRuler.uid && [1027, 1140].includes(effect.code ?? 0)).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryDisable | categoryDestroy, code: 1027, event: "quick", property: 49152, range: ["monsterZone"], triggerEvent: "chaining" },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned", "coinTossed"].includes(event.eventName))).toEqual([
      sentToGraveEvent(materialA.uid, lightRuler.uid, 0),
      sentToGraveEvent(materialB.uid, lightRuler.uid, 1),
      sentToGraveEvent(materialC.uid, lightRuler.uid, 2),
      {
        ...sentToGraveEvent(materialA.uid, lightRuler.uid, 0),
        eventUids: [materialA.uid, materialB.uid, materialC.uid],
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: lightRuler.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lightRuler.uid,
        eventReasonEffectId: 4,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force EX - The Light Ruler");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_UNCOPYABLE)");
  expect(script).toContain("return Duel.GetLocationCount(tp,LOCATION_MZONE)>-3 and #rg>2 and aux.SelectUnselectGroup(rg,e,tp,3,3,nil,0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,3,3,nil,1,tp,HINTMSG_TOGRAVE,nil,nil,true)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("Arcana.GetCoinResult(c)==COIN_HEADS");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
  expect(script).toContain("e2:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_F)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return Arcana.GetCoinResult(c)==COIN_TAILS and (re:IsHasType(EFFECT_TYPE_ACTIVATE) or re:IsMonsterEffect())");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
  expect(script).toContain("aux.DoubleSnareValidity(c,LOCATION_MZONE)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const lightRuler = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === lightRulerCode);
  expect(lightRuler).toBeDefined();
  return [
    lightRuler!,
    { code: materialACode, name: "Light Ruler Material A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Light Ruler Material B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1100, defense: 1000 },
    { code: materialCCode, name: "Light Ruler Material C", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
  ];
}

function sentToGraveEvent(cardUid: string, sourceUid: string, sequence: number) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence },
  };
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
