import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Des Feral Imp flip grave to deck", () => {
  it("restores its Flip target and shuffles an own Graveyard card into the Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const impCode = "81985784";
    const targetCode = "81985785";
    const responderCode = "81985786";
    const script = workspace.readScript(`c${impCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("return c:IsAbleToDeck()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,g,#g,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e)");
    expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === impCode),
      {
        code: targetCode,
        name: "Des Feral Imp Graveyard Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1200,
        defense: 1000,
      },
      {
        code: responderCode,
        name: "Des Feral Imp Chain Responder",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000,
        defense: 1000,
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 81985784, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [impCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const imp = requireCard(session, impCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    const movedImp = moveDuelCard(session.state, imp.uid, "monsterZone", 0);
    movedImp.position = "faceDownDefense";
    movedImp.faceUp = false;
    moveDuelCard(session.state, target.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(impCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const flip = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "flipSummon" && action.uid === imp.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, flip!);
    expect(restoredOpenWindow.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-3-1",
        effectId: "lua-1",
        sourceUid: imp.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: imp.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
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

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === imp.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([]);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: imp.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: imp.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        targetFieldIds: [5],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x10, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.session.state.chain).toEqual(restoredTriggerWindow.session.state.chain);
    const responderAction = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.uid === responder.uid);
    expect(responderAction).toBeDefined();
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === imp.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).not.toContain("des feral imp responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => ["flipSummoned", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: imp.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
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
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: target.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: imp.uid,
        eventReasonEffectId: 1,
      },
    ]);
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
      e:SetOperation(function(e,tp) Debug.Message("des feral imp responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
