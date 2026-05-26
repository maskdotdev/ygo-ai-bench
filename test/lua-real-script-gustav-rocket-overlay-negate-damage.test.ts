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
const gustavRocketCode = "92359409";
const materialCode = "923594090";
const starterCode = "923594091";
const drawCode = "923594092";
const hasGustavRocketScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gustavRocketCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x80;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGustavRocketScript)("Lua real script Superdreadnought Rail Cannon Gustav Rocket overlay negate damage", () => {
  it("restores overlay-gated monster-effect negation into destruction, BreakEffect, and 1000 damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gustavRocketCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader([
      { code: gustavRocketCode, name: "Superdreadnought Rail Cannon Gustav Rocket", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeEarth, level: 10, attack: 3000, defense: 3000 },
      { code: materialCode, name: "Gustav Rocket Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 10, attack: 2000, defense: 2000 },
      { code: starterCode, name: "Gustav Rocket Monster Effect Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1600, defense: 1600 },
      { code: drawCode, name: "Gustav Rocket Suppressed Draw", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    ] satisfies DuelCardData[]);
    const session = createDuel({ seed: 92359409, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [gustavRocketCode] }, 1: { main: [starterCode, drawCode] } });
    startDuel(session);

    const rocket = requireCard(session, gustavRocketCode);
    const material = requireCard(session, materialCode);
    const starter = requireCard(session, starterCode);
    const draw = requireCard(session, drawCode);
    moveFaceUpAttack(session, rocket, 0, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    rocket.overlayUids.push(material.uid);
    moveFaceUpAttack(session, starter, 1, 0);
    moveDuelCard(session.state, draw.uid, "deck", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterMonsterEffectScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gustavRocketCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredStarterOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredStarterOpen);
    expectRestoredLegalActions(restoredStarterOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredStarterOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredStarterOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStarterOpen, starterAction!);
    expect(restoredStarterOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-4-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 1 }],
      },
    ]);

    const restoredChainResponse = restoreDuelWithLuaScripts(serializeDuel(restoredStarterOpen.session), source, reader);
    expectCleanRestore(restoredChainResponse);
    expectRestoredLegalActions(restoredChainResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredChainResponse, 0).find((action) => action.type === "activateEffect" && action.uid === rocket.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredChainResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChainResponse, negate!);
    expect(restoredChainResponse.session.state.chain).toHaveLength(2);
    passRestoredChain(restoredChainResponse);

    expect(restoredChainResponse.session.state.chain).toHaveLength(0);
    expect(restoredChainResponse.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: rocket.uid,
      reasonEffectId: 2,
    });
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === rocket.uid)?.overlayUids).toEqual([material.uid]);
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restoredChainResponse.host.messages).not.toContain("gustav rocket starter resolved");
    expect(restoredChainResponse.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled", "destroyed", "breakEffect", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: starter.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: rocket.uid, eventReasonEffectId: 2, relatedEffectId: undefined, eventChainLinkId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rocket.uid, eventReasonEffectId: 2, relatedEffectId: undefined, eventChainLinkId: undefined, previous: undefined, current: undefined },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 1000, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rocket.uid, eventReasonEffectId: 2, relatedEffectId: undefined, eventChainLinkId: undefined, previous: undefined, current: undefined },
      { eventName: "chainNegated", eventCode: 1024, eventCardUid: undefined, eventPlayer: 1, eventValue: 1, eventReason: undefined, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, eventChainLinkId: "chain-2", previous: undefined, current: undefined },
      { eventName: "chainDisabled", eventCode: 1025, eventCardUid: undefined, eventPlayer: 1, eventValue: 1, eventReason: undefined, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, eventChainLinkId: "chain-2", previous: undefined, current: undefined },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Superdreadnought Rail Cannon Gustav Rocket");
  expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE+CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return rp==1-tp and re:IsMonsterEffect() and e:GetHandler():GetOverlayCount()>0 and Duel.IsChainDisablable(ev)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Damage(1-tp,1000,REASON_EFFECT)");
}

function starterMonsterEffectScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("gustav rocket starter resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
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
