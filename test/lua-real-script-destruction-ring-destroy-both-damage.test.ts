import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const destructionRingCode = "21219755";
const targetCode = "21219756";
const responderCode = "21219757";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Destruction Ring destroy both-player damage", () => {
  it("restores its selected own face-up monster target, destruction, both-player damage, and RDComplete", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${destructionRingCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,1000)");
    expect(script).toContain("Duel.Damage(1-tp,1000,REASON_EFFECT,true)");
    expect(script).toContain("Duel.Damage(tp,1000,REASON_EFFECT,true)");
    expect(script).toContain("Duel.RDComplete()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === destructionRingCode),
      { code: targetCode, name: "Destruction Ring Face-up Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1200 },
      { code: responderCode, name: "Destruction Ring Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21219755, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destructionRingCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ring = requireCard(session, destructionRingCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    const ringSet = moveDuelCard(session.state, ring.uid, "spellTrapZone", 0);
    ringSet.position = "faceDown";
    ringSet.faceUp = false;
    const targetOnField = moveDuelCard(session.state, target.uid, "monsterZone", 0);
    targetOnField.sequence = 0;
    targetOnField.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(destructionRingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activateRing = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === ring.uid);
    expect(activateRing, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activateRing!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1000 },
    ]);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [
        { category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1000 },
      ],
      player: 0,
      sourceUid: ring.uid,
      targetFieldIds: [5],
      targetUids: [target.uid],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1000 },
    ]);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === ring.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ring.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.players[0].lifePoints).toBe(7000);
    expect(restored.session.state.players[1].lifePoints).toBe(7000);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ring.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ring.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ring.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(host.messages).not.toContain("destruction ring responder resolved");
    expect(restored.host.messages).not.toContain("destruction ring responder resolved");

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredResolved.session.state.players[1].lifePoints).toBe(7000);
  });
});

function expectCleanRestore(restored: LuaSnapshotRestoreResult): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): void {
  const groups = getLuaRestoreLegalActionGroups(restored, player);
  const actions = getLuaRestoreLegalActions(restored, player);
  expect(actions).toEqual(getLegalActions(restored.session, player));
  expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(groups.flatMap((group) => group.actions)).toEqual(actions);
}

function applyRestoredActionAndAssert(restored: LuaSnapshotRestoreResult, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("destruction ring responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
