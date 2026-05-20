import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasShieldScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c1164211.lua"));
const shieldCode = "1164211";
const millenniumCrossCode = "37613663";
const responderCode = "11642110";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasShieldScript)("Lua real script Millennium Shield place summon search", () => {
  it("restores hand placement as Continuous Spell, LP-cost summon, optional Cross search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${shieldCode}.lua`);
    expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_SZONE,POS_FACEUP,true)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_TYPE)");
    expect(script).toContain("e1:SetValue(TYPE_SPELL|TYPE_CONTINUOUS)");
    expect(script).toContain("Duel.CheckLPCost(tp,2000)");
    expect(script).toContain("Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.PayLPCost(tp,2000)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,4))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.SendtoHand(g,tp,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: shieldCode, name: "Shield of the Millennium Dynasty", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, attack: 0, defense: 3000 },
      { code: millenniumCrossCode, name: "Millennium Cross", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: responderCode, name: "Millennium Shield Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1164211, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shieldCode, millenniumCrossCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const shield = requireCard(session, shieldCode);
    const cross = requireCard(session, millenniumCrossCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, shield.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shieldCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const place = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === shield.uid);
    expect(place, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, place!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: shield.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
      },
    ]);

    const restoredPlace = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredPlace);
    expectRestoredLegalActions(restoredPlace, 1);
    expect(getLuaRestoreLegalActions(restoredPlace, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredPlace);
    expect(restoredPlace.host.messages).not.toContain("millennium shield responder resolved");
    expect(restoredPlace.session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredPlace.session.state.effects.find((effect) => effect.sourceUid === shield.uid && effect.code === 117)).toMatchObject({
      code: 117,
      value: typeSpell | typeContinuous,
      sourceUid: shield.uid,
    });

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredPlace.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const summon = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === shield.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredIgnition, summon!);
    expect(restoredIgnition.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredIgnition.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-3",
        sourceUid: shield.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [
          { category: 0x200, targetUids: [shield.uid], count: 1, player: 0, parameter: 0 },
        ],
        possibleOperationInfos: [
          { category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 },
        ],
      },
    ]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 1);
    resolveRestoredChain(restoredSummon);
    expect(restoredSummon.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 18627380, returned: true },
    ]);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: shield.uid,
      reasonEffectId: 3,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === cross.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: shield.uid,
      reasonEffectId: 3,
    });
    expect(restoredSummon.host.messages).toContain(`confirmed 1: ${millenniumCrossCode}`);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["lifePointCostPaid", "specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 2000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: shield.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: shield.uid,
        eventUids: [shield.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: shield.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: cross.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shield.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: cross.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [cross.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shield.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: cross.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [cross.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shield.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("millennium shield responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
