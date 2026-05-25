import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Soul Release target banish", () => {
  it("restores multiple targeted Graveyard monsters, then banishes only related targets", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const soulReleaseCode = "5758500";
    const ownFieldCode = "57585001";
    const ownGraveCode = "57585002";
    const opponentFieldCode = "57585003";
    const opponentGraveAcode = "57585004";
    const opponentGraveBcode = "57585005";
    const responderCode = "57585006";
    const script = workspace.readScript(`c${soulReleaseCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsAbleToRemove() and aux.SpElimFilter(c)");
    expect(script).toContain("Duel.IsExistingTarget(s.rmfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.rmfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,1,5,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,0,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("g:Filter(Card.IsRelateToEffect,nil,e)");
    expect(script).toContain("Duel.Remove(sg,POS_FACEUP,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === soulReleaseCode),
      { code: ownFieldCode, name: "Soul Release Own Field Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: ownGraveCode, name: "Soul Release Own Grave Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
      { code: opponentFieldCode, name: "Soul Release Opponent Field Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: opponentGraveAcode, name: "Soul Release Opponent Grave Target A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000 },
      { code: opponentGraveBcode, name: "Soul Release Opponent Grave Target B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: responderCode, name: "Soul Release Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5758500, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [soulReleaseCode, ownFieldCode, ownGraveCode] },
      1: { main: [opponentFieldCode, opponentGraveAcode, opponentGraveBcode, responderCode] },
    });
    startDuel(session);

    const soulRelease = requireCard(session.state.cards, soulReleaseCode);
    const ownField = requireCard(session.state.cards, ownFieldCode);
    const ownGrave = requireCard(session.state.cards, ownGraveCode);
    const opponentField = requireCard(session.state.cards, opponentFieldCode);
    const opponentGraveA = requireCard(session.state.cards, opponentGraveAcode);
    const opponentGraveB = requireCard(session.state.cards, opponentGraveBcode);
    const responder = requireCard(session.state.cards, responderCode);
    moveDuelCard(session.state, soulRelease.uid, "hand", 0);
    const movedOwnField = moveDuelCard(session.state, ownField.uid, "monsterZone", 0);
    movedOwnField.position = "faceUpAttack";
    movedOwnField.faceUp = true;
    moveDuelCard(session.state, ownGrave.uid, "graveyard", 0).faceUp = true;
    const movedOpponentField = moveDuelCard(session.state, opponentField.uid, "monsterZone", 1);
    movedOpponentField.position = "faceUpAttack";
    movedOpponentField.faceUp = true;
    moveDuelCard(session.state, opponentGraveA.uid, "graveyard", 1).faceUp = true;
    moveDuelCard(session.state, opponentGraveB.uid, "graveyard", 1).faceUp = true;
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
    expect(host.loadCardScript(Number(soulReleaseCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === soulRelease.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    const targetUids = [ownGrave.uid, opponentGraveA.uid, opponentGraveB.uid];
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: soulRelease.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x4, targetUids, count: 3, player: 0, parameter: 0 }],
        targetFieldIds: [ownGrave.fieldId, opponentGraveA.fieldId, opponentGraveB.fieldId],
        targetUids,
      },
    ]);

    const previousStates = new Map(targetUids.map((uid) => [uid, cardEventState(requireCardByUid(session.state.cards, uid))]));
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x4, targetUids, count: 3, player: 0, parameter: 0 }]);
    expect(restored.session.state.chain[0]?.targetUids).toEqual(targetUids);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === soulRelease.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ownField.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentField.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    for (const uid of targetUids) {
      expect(restored.session.state.cards.find((card) => card.uid === uid)).toMatchObject({ location: "banished", faceUp: true });
    }
    expect(restored.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.host.messages).not.toContain("soul release responder resolved");

    const banishedEvents = restored.session.state.eventHistory.filter((event) => event.eventName === "banished");
    const firstTargetUid = targetUids[0]!;
    expect(banishedEvents).toEqual([
      ...targetUids.map((uid) => ({
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: soulRelease.uid,
        eventReasonEffectId: 1,
        eventPreviousState: previousStates.get(uid)!,
        eventCurrentState: { ...previousStates.get(uid)!, location: "banished" },
      })),
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: firstTargetUid,
        eventUids: targetUids,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: soulRelease.uid,
        eventReasonEffectId: 1,
        eventPreviousState: previousStates.get(firstTargetUid)!,
        eventCurrentState: { ...previousStates.get(firstTargetUid)!, location: "banished", position: "faceUpAttack" },
      },
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCardByUid(cards: DuelCardInstance[], uid: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
  };
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
      e:SetOperation(function(e,tp) Debug.Message("soul release responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
