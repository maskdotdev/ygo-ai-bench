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
const narwhalCode = "6568731";
const allyCode = "65687310";
const starterCode = "65687311";
const hasNarwhalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${narwhalCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceAqua = 0x40;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasNarwhalScript)("Lua real script Glacial Beast Iceberg Narwhal destroyed burn", () => {
  it("restores its opponent-effect destroyed monster trigger and burns the targeted opponent for 600", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${narwhalCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 6568731, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [allyCode], extra: [narwhalCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const narwhal = requireCard(session, narwhalCode);
    const ally = requireCard(session, allyCode);
    const starter = requireCard(session, starterCode);
    moveFaceUpAttack(session, narwhal, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, starter, 1, 0);
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return destroyStarterScript(allyCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(narwhalCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredStarterOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredStarterOpen);
    expectRestoredLegalActions(restoredStarterOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredStarterOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredStarterOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStarterOpen, starterAction!);
    passRestoredChain(restoredStarterOpen);

    expect(restoredStarterOpen.host.messages).toContain("narwhal starter resolved");
    expect(restoredStarterOpen.session.state.cards.find((card) => card.uid === ally.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: starter.uid,
      reasonEffectId: 5,
    });
    expect(restoredStarterOpen.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-3-1029",
        eventCardUid: ally.uid,
        eventCode: 1029,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "destroyed",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: starter.uid,
        eventReasonEffectId: 5,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        id: "trigger-4-1",
        player: 0,
        sourceUid: narwhal.uid,
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredStarterOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const burn = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === narwhal.uid);
    expect(burn, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, burn!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.chain).toHaveLength(0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(7400);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ally.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: starter.uid, eventReasonEffectId: 5, relatedEffectId: undefined, eventChainLinkId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 600, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: narwhal.uid, eventReasonEffectId: 3, relatedEffectId: undefined, eventChainLinkId: undefined, previous: undefined, current: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: narwhalCode, name: "Glacial Beast Iceberg Narwhal", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceAqua, attribute: attributeWater, level: 7, attack: 2700, defense: 1600 },
    { code: allyCode, name: "Narwhal WATER Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1500, defense: 1200 },
    { code: starterCode, name: "Narwhal Destroy Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1600, defense: 1600 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Glacial Beast Iceberg Narwhal");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsAttribute,ATTRIBUTE_WATER),1,99)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_MZONE) and c:IsReason(REASON_DESTROY)");
  expect(script).toContain("c:IsReason(REASON_EFFECT) and c:GetReasonPlayer()==1-tp");
  expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
  expect(script).toContain("Duel.SetTargetParam(600)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,600)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.NegateEffect(ev)");
}

function destroyStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetCode}) end
        local g=Duel.GetMatchingGroup(Card.IsCode,tp,0,LOCATION_MZONE,nil,${targetCode})
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,1-tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.GetMatchingGroup(Card.IsCode,tp,0,LOCATION_MZONE,nil,${targetCode})
        Debug.Message("narwhal starter resolved")
        Duel.Destroy(g,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
  moved.faceUp = true;
  return moved;
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainLinkId?: string;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    eventChainLinkId: event.eventChainLinkId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
}
