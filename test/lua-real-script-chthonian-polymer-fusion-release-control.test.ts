import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const chthonianPolymerCode = "72287557";
const releaseCostCode = "722875570";
const excludedCostCode = "722875571";
const opponentFusionCode = "722875572";
const chainStarterCode = "722875573";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChthonianPolymerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chthonianPolymerCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeFusion = 0x40;
const categoryControl = 0x2000;
const eventSpecialSummonSuccess = 1102;
const summonTypeFusion = 0x43000000;

describe.skipIf(!hasUpstreamScripts || !hasChthonianPolymerScript)("Lua real script Chthonian Polymer fusion release control", () => {
  it("restores opponent Fusion Summon trigger into release cost and SetTargetCard control take", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chthonianPolymerCode}.lua`);
    expect(script).toContain("--Chthonian Polymer");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return #eg==1 and tc:IsControler(1-tp) and tc:IsFusionSummoned()");
    expect(script).toContain("return Duel.GetMZoneCount(tp,c)>0 and not eg:IsContains(c)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil,tp,eg)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil,tp,eg)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("Duel.SetTargetCard(eg)");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 72287557, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [chthonianPolymerCode, releaseCostCode, excludedCostCode] },
      1: { main: [chainStarterCode], extra: [opponentFusionCode] },
    });
    startDuel(session);

    const polymer = requireCard(session, chthonianPolymerCode);
    const releaseCost = requireCard(session, releaseCostCode);
    const excludedCost = requireCard(session, excludedCostCode);
    const opponentFusion = requireCard(session, opponentFusionCode);
    const chainStarter = requireCard(session, chainStarterCode);
    moveSetTrap(session, polymer);
    moveFaceUpAttack(session, releaseCost, 0, 0);
    moveFaceUpAttack(session, excludedCost, 0, 1);
    moveDuelCard(session.state, chainStarter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chthonianPolymerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    specialSummonDuelCard(session.state, opponentFusion.uid, 1, 1, {}, summonTypeFusion);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === polymer.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      {
        category: categoryControl,
        code: eventSpecialSummonSuccess,
        event: "quick",
        id: `lua-1-${eventSpecialSummonSuccess}`,
        property: 0x10,
        triggerEvent: "specialSummoned",
      },
    ]);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === polymer.uid)).toEqual([]);
    const starter = getLuaRestoreLegalActions(restoredTrigger, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === chainStarter.uid
    );
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, starter!);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateEffect" && action.uid === polymer.uid && action.effectId === `lua-1-${eventSpecialSummonSuccess}`
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);

    expect(findCard(restoredTrigger.session, releaseCost.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonCardUid: polymer.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(findCard(restoredTrigger.session, excludedCost.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      sequence: 1,
    });
    expect(findCard(restoredTrigger.session, opponentFusion.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      previousController: 1,
      reason: duelReason.effect,
      reasonCardUid: polymer.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
      summonType: "fusion",
    });
    expect(findCard(restoredTrigger.session, polymer.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "released", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { currentController: 1, currentLocation: "monsterZone", eventCardUid: opponentFusion.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previousController: 1, previousLocation: "extraDeck", relatedEffectId: undefined },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: releaseCost.uid, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: polymer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 0, previousLocation: "monsterZone", relatedEffectId: undefined },
      { currentController: 1, currentLocation: "monsterZone", eventCardUid: opponentFusion.uid, eventName: "becameTarget", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previousController: 1, previousLocation: "extraDeck", relatedEffectId: 1 },
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: opponentFusion.uid, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: polymer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 1, previousLocation: "monsterZone", relatedEffectId: undefined },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 1);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: chthonianPolymerCode, name: "Chthonian Polymer", kind: "trap", typeFlags: typeTrap },
    { code: releaseCostCode, name: "Chthonian Polymer Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
    { code: excludedCostCode, name: "Chthonian Polymer Cost Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
    { code: opponentFusionCode, name: "Chthonian Polymer Opponent Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 6, attack: 2300, defense: 1800 },
    { code: chainStarterCode, name: "Chthonian Polymer Chain Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SPSUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp,eg) return eg:IsExists(Card.IsControler,1,nil,tp) end)
      e:SetOperation(function(e,tp) Debug.Message("chthonian polymer starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveSetTrap(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
  return moved;
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
