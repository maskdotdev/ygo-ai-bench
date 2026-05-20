import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const lamiaCode = "57647597";
const reptileCode = "576475970";
const opponentCode = "576475971";
const zeroAtkDecoyCode = "576475972";
const responderCode = "576475973";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts)("Lua real script Reptilianne Lamia hand target special damage", () => {
  it("restores hand ignition target ATK final zero, self Special Summon, BreakEffect, and damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lamiaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_SPECIAL_SUMMON+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)");
    expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_REPTILE),tp,LOCATION_MZONE,0,nil)==fc");
    expect(script).toContain("return c:HasNonZeroAttack() and c:GetBaseAttack()>0");
    expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,g:GetFirst():GetBaseAttack())");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Damage(tp,atk,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: lamiaCode, name: "Reptilianne Lamia", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 2, attack: 0, defense: 0 },
      { code: reptileCode, name: "Lamia Reptile Gate", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 4, attack: 1000, defense: 1000 },
      { code: opponentCode, name: "Lamia Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
      { code: zeroAtkDecoyCode, name: "Lamia Zero ATK Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 0, defense: 1000 },
      { code: responderCode, name: "Lamia Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 57647597, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lamiaCode, reptileCode] }, 1: { main: [opponentCode, zeroAtkDecoyCode, responderCode] } });
    startDuel(session);

    const lamia = requireCard(session.state.cards, lamiaCode);
    const reptile = requireCard(session.state.cards, reptileCode);
    const opponent = requireCard(session.state.cards, opponentCode);
    const zeroAtkDecoy = requireCard(session.state.cards, zeroAtkDecoyCode);
    const responder = requireCard(session.state.cards, responderCode);
    moveDuelCard(session.state, lamia.uid, "hand", 0);
    moveFaceUpAttack(session, reptile, 0);
    moveFaceUpAttack(session, opponent, 1);
    moveFaceUpAttack(session, zeroAtkDecoy, 1);
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
    expect(host.loadCardScript(Number(lamiaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lamia.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    expect(("targetUids" in activation! ? activation!.targetUids : []) ?? []).toEqual([]);
    expect(("operationInfos" in activation! ? activation!.operationInfos : []) ?? []).toEqual([]);
    applyAndAssert(session, activation!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: lamia.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetUids: [opponent.uid],
        operationInfos: [
          { category: 0x200, targetUids: [lamia.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1800 },
        ],
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    const response = applyLuaRestoreResponse(restoredChain, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(restoredChain.session.state.chain).toEqual([]);

    const resolvedLamia = restoredChain.session.state.cards.find((card) => card.uid === lamia.uid);
    const resolvedOpponent = restoredChain.session.state.cards.find((card) => card.uid === opponent.uid);
    expect(resolvedLamia).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true, position: "faceUpAttack", summonType: "special" });
    expect(currentAttack(resolvedOpponent, restoredChain.session.state)).toBe(0);
    expect(restoredChain.session.state.players[0].lifePoints).toBe(6200);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["specialSummoned", "breakEffect", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: lamia.uid,
        eventUids: [lamia.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: lamia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lamia.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lamia.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function() Debug.Message("lamia responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.reason = duelReason.summon;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
