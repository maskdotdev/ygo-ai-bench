import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const kingArthurCode = "77631175";
const materialCode = "776311750";
const responderCode = "776311751";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts)("Lua real script King Arthur replace custom burn", () => {
  it("restores battle destroy replacement into custom-event ATK gain and burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kingArthurCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_WARRIOR),4,2)");
    expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
    expect(script).toContain("return c:IsReason(REASON_BATTLE) and c:CheckRemoveOverlayCard(tp,1,REASON_EFFECT)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)");
    expect(script).toContain("Duel.RaiseSingleEvent(c,EVENT_CUSTOM+id,e,0,0,0,0)");
    expect(script).toContain("e2:SetCode(EVENT_CUSTOM+id)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(500)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,500)");
    expect(script).toContain("if c:UpdateAttack(500)==500 then");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: kingArthurCode, name: "Comics Hero King Arthur", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, level: 4, attack: 2400, defense: 1200 },
      { code: materialCode, name: "King Arthur Overlay Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "King Arthur Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 77631175, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [kingArthurCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const kingArthur = requireCard(session, kingArthurCode);
    const material = requireCard(session, materialCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, kingArthur, 0);
    kingArthur.summonType = "xyz";
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    kingArthur.overlayUids.push(material.uid);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kingArthurCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const replaced = destroyDuelCard(restoredOpen.session.state, kingArthur.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(replaced).toMatchObject({ location: "monsterZone", controller: 0, overlayUids: [] });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: kingArthur.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true },
    ]);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-346066631",
        sourceUid: kingArthur.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "customEvent",
        eventCode: 346066631,
        eventCardUid: kingArthur.uid,
        eventUids: [kingArthur.uid],
        eventPlayer: 0,
        eventValue: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: kingArthur.uid,
        eventReasonEffectId: 2,
        relatedEffectId: 2,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === kingArthur.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in trigger! ? trigger!.operationInfos : []) ?? []).toEqual([]);
    applyRestoredAction(restoredTrigger, trigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-3-346066631",
        sourceUid: kingArthur.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "customEvent",
        eventCode: 346066631,
        eventCardUid: kingArthur.uid,
        eventUids: [kingArthur.uid],
        eventPlayer: 0,
        eventValue: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: kingArthur.uid,
        eventReasonEffectId: 2,
        relatedEffectId: 2,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 500 }],
        targetParam: 500,
        targetPlayer: 1,
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    const response = applyLuaRestoreResponse(restoredChain, pass!);
    expect(response.ok, response.error).toBe(true);

    const resolvedKingArthur = restoredChain.session.state.cards.find((card) => card.uid === kingArthur.uid);
    expect(resolvedKingArthur).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(currentAttack(resolvedKingArthur, restoredChain.session.state)).toBe(2900);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["detachedMaterial", "customEvent", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kingArthur.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "customEvent",
        eventCode: 346066631,
        eventCardUid: kingArthur.uid,
        eventUids: [kingArthur.uid],
        eventPlayer: 0,
        eventValue: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: kingArthur.uid,
        eventReasonEffectId: 2,
        relatedEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kingArthur.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.reason = duelReason.summon | duelReason.specialSummon | duelReason.xyz;
  card.reasonPlayer = controller;
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function() Debug.Message("king arthur responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
