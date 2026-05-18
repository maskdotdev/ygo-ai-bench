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
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Xyz Reversal targeted SwapControl", () => {
  it("restores Xyz Reversal's two selected targets and swaps control from chain target cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reversalCode = "66604523";
    const ownXyzCode = "66604524";
    const opponentXyzCode = "66604525";
    const responderCode = "66604526";
    const script = workspace.readScript(`official/c${reversalCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g1,2,0,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("Duel.SwapControl(a,b)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === reversalCode),
      { code: ownXyzCode, name: "Xyz Reversal Own Xyz", kind: "monster", typeFlags: typeMonster | typeXyz, level: 4, attack: 2200, defense: 1000 },
      { code: opponentXyzCode, name: "Xyz Reversal Opponent Xyz", kind: "monster", typeFlags: typeMonster | typeXyz, level: 4, attack: 2500, defense: 1500 },
      { code: responderCode, name: "Xyz Reversal Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6660, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reversalCode, ownXyzCode] }, 1: { main: [opponentXyzCode, responderCode] } });
    startDuel(session);

    const reversal = requireCard(session, reversalCode);
    const ownXyz = requireCard(session, ownXyzCode);
    const opponentXyz = requireCard(session, opponentXyzCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, reversal.uid, "spellTrapZone", 0);
    reversal.position = "faceDown";
    reversal.faceUp = false;
    moveFaceUpAttack(session, ownXyz, 0);
    moveFaceUpAttack(session, opponentXyz, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(reversalCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === reversal.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        player: 0,
        sourceUid: reversal.uid,
        effectId: "lua-1-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [
          {
            category: 0x2000,
            targetUids: [ownXyz.uid, opponentXyz.uid],
            count: 2,
            player: 0,
            parameter: 0,
          },
        ],
        targetUids: [opponentXyz.uid, ownXyz.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        player: 0,
        sourceUid: reversal.uid,
        effectId: "lua-1-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [
          {
            category: 0x2000,
            targetUids: [ownXyz.uid, opponentXyz.uid],
            count: 2,
            player: 0,
            parameter: 0,
          },
        ],
        targetUids: [opponentXyz.uid, ownXyz.uid],
      },
    ]);

    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, pass!);
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownXyz.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentXyz.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === reversal.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.host.messages).not.toContain("xyz reversal responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged")).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: opponentXyz.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: reversal.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: ownXyz.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: reversal.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: opponentXyz.uid,
        eventUids: [opponentXyz.uid, ownXyz.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: reversal.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const restoredAfterSwap = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterSwap);
    expectRestoredLegalActions(restoredAfterSwap, 0);
    expect(restoredAfterSwap.session.state.cards.find((card) => card.uid === ownXyz.uid)).toMatchObject({ controller: 1, previousController: 0 });
    expect(restoredAfterSwap.session.state.cards.find((card) => card.uid === opponentXyz.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("xyz reversal responder resolved") end)
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
