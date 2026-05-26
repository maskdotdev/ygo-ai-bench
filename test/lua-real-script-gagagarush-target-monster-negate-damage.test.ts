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
const gagagarushCode = "13166204";
const gagagaCode = "131662040";
const starterCode = "131662041";
const hasGagagarushScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gagagarushCode}.lua`));
const setGagaga = 0x54;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasGagagarushScript)("Lua real script Gagagarush target monster negate damage", () => {
  it("restores targeted Gagaga monster chain response into monster-effect negation, destruction, BreakEffect, and damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gagagarushCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 13166204, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gagagarushCode, gagagaCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const gagagarush = requireCard(session, gagagarushCode);
    const gagaga = requireCard(session, gagagaCode);
    const starter = requireCard(session, starterCode);
    moveSpellTrap(session, gagagarush, 0, 0);
    moveFaceUpAttack(session, gagaga, 0, 0);
    moveFaceUpAttack(session, starter, 1, 0);
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return targetingMonsterStarterScript(gagagaCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gagagarushCode), source).ok).toBe(true);
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
        effectId: "lua-2",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: [gagaga.uid], count: 1, player: 0, parameter: 0x4 }],
        targetFieldIds: [gagaga.fieldId],
        targetUids: [gagaga.uid],
      },
    ]);

    const restoredChainResponse = restoreDuelWithLuaScripts(serializeDuel(restoredStarterOpen.session), source, reader);
    expectCleanRestore(restoredChainResponse);
    expectRestoredLegalActions(restoredChainResponse, 0);
    expect(restoredChainResponse.session.state.effects.filter((effect) => effect.sourceUid === gagagarush.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x10000000 | 0x80000 | 0x1, code: 1028, event: "quick", range: ["spellTrapZone"], triggerEvent: "becameTarget" },
    ]);
    const negate = getLuaRestoreLegalActions(restoredChainResponse, 0).find((action) => action.type === "activateEffect" && action.uid === gagagarush.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredChainResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChainResponse, negate!);
    passRestoredChain(restoredChainResponse);

    expect(restoredChainResponse.session.state.chain).toHaveLength(0);
    expect(restoredChainResponse.session.state.players[1].lifePoints).toBe(5800);
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: gagagarush.uid, reasonEffectId: 1 });
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === gagaga.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainResponse.host.messages).not.toContain("gagagarush starter resolved");
    expect(restoredChainResponse.session.state.eventHistory.filter((event) => ["becameTarget", "chainNegated", "chainDisabled", "destroyed", "breakEffect", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: gagaga.uid, eventPlayer: undefined, eventValue: 1, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, eventChainLinkId: "chain-2", previous: "deck", current: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: starter.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gagagarush.uid, eventReasonEffectId: 1, relatedEffectId: undefined, eventChainLinkId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gagagarush.uid, eventReasonEffectId: 1, relatedEffectId: undefined, eventChainLinkId: undefined, previous: undefined, current: undefined },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 2200, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gagagarush.uid, eventReasonEffectId: 1, relatedEffectId: undefined, eventChainLinkId: undefined, previous: undefined, current: undefined },
      { eventName: "chainNegated", eventCode: 1024, eventCardUid: undefined, eventPlayer: 1, eventValue: 1, eventReason: undefined, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, eventChainLinkId: "chain-2", previous: undefined, current: undefined },
      { eventName: "chainDisabled", eventCode: 1025, eventCardUid: undefined, eventPlayer: 1, eventValue: 1, eventReason: undefined, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, eventChainLinkId: "chain-2", previous: undefined, current: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gagagarushCode, name: "Gagagarush", kind: "trap", typeFlags: typeTrap },
    { code: gagagaCode, name: "Gagaga Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1500, setcodes: [setGagaga] },
    { code: starterCode, name: "Gagagarush Targeting Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 2200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gagagarush");
  expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_NEGATE+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_BECOME_TARGET)");
  expect(script).toContain("s.listed_series={SET_GAGAGA}");
  expect(script).toContain("return c:IsFaceup() and c:IsControler(tp) and c:IsLocation(LOCATION_MZONE) and c:IsSetCard(SET_GAGAGA)");
  expect(script).toContain("return rp~=tp and re:IsMonsterEffect() and eg:IsExists(s.filter,1,nil,tp) and Duel.IsChainDisablable(ev)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("Duel.Destroy(re:GetHandler(),REASON_EFFECT)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("if b>a then a=b end");
  expect(script).toContain("Duel.Damage(1-tp,a,REASON_EFFECT)");
}

function targetingMonsterStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsOnField() and chkc:IsCode(${targetCode}) end
        if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetCode}) end
        local g=Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${targetCode})
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,1-tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then
          Debug.Message("gagagarush starter resolved")
          Duel.Destroy(tc,REASON_EFFECT)
        end
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

function moveSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.position = "faceDown";
  moved.faceUp = false;
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
