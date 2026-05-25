import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Two-Pronged Attack chain-info destroy", () => {
  it("restores its three targeted monsters from CHAININFO_TARGET_CARDS and destroys only related targets", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const twoProngedCode = "83887306";
    const ownFirstCode = "838873060";
    const ownSecondCode = "838873061";
    const opponentTargetCode = "838873062";
    const responderCode = "838873063";
    const script = workspace.readScript(`c${twoProngedCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.IsExistingTarget(aux.TRUE,tp,LOCATION_MZONE,0,2,nil)");
    expect(script).toContain("Duel.IsExistingTarget(aux.TRUE,tp,0,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_MZONE,0,2,2,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g1,3,0,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("g:Filter(Card.IsRelateToEffect,nil,e)");
    expect(script).toContain("if #tg==3 then");
    expect(script).toContain("Duel.Destroy(tg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === twoProngedCode),
      { code: ownFirstCode, name: "Two-Pronged Own First Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: ownSecondCode, name: "Two-Pronged Own Second Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: opponentTargetCode, name: "Two-Pronged Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Two-Pronged Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 83887306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [opponentTargetCode, responderCode] }, 1: { main: [twoProngedCode, ownFirstCode, ownSecondCode] } });
    startDuel(session);

    const twoPronged = requireCard(session, twoProngedCode);
    const ownFirst = requireCard(session, ownFirstCode);
    const ownSecond = requireCard(session, ownSecondCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const responder = requireCard(session, responderCode);
    const movedTrap = moveDuelCard(session.state, twoPronged.uid, "spellTrapZone", 1);
    movedTrap.position = "faceDown";
    movedTrap.faceUp = false;
    movedTrap.turnId = 0;
    const movedFirst = moveDuelCard(session.state, ownFirst.uid, "monsterZone", 1);
    movedFirst.sequence = 0;
    movedFirst.position = "faceUpAttack";
    movedFirst.faceUp = true;
    const movedSecond = moveDuelCard(session.state, ownSecond.uid, "monsterZone", 1);
    movedSecond.sequence = 1;
    movedSecond.position = "faceUpAttack";
    movedSecond.faceUp = true;
    const movedOpponent = moveDuelCard(session.state, opponentTarget.uid, "monsterZone", 0);
    movedOpponent.position = "faceUpAttack";
    movedOpponent.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turn = 1;
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(twoProngedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === twoPronged.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    const targetUids = [ownFirst.uid, ownSecond.uid, opponentTarget.uid];
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: twoPronged.uid,
        player: 1,
        effectId: "lua-2-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids, count: 3, player: 0, parameter: 0 }],
        targetFieldIds: [ownFirst.fieldId, ownSecond.fieldId, opponentTarget.fieldId],
        targetUids,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === twoPronged.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === ownFirst.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === ownSecond.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("two-pronged attack responder resolved");
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownFirst.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: twoPronged.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownSecond.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: twoPronged.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentTarget.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: twoPronged.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownFirst.uid,
        eventUids: targetUids,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: twoPronged.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("two-pronged attack responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
