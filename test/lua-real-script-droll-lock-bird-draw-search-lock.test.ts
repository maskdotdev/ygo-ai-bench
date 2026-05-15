import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Droll & Lock Bird", () => {
  it("restores its custom-event hand trigger and locks Deck-to-hand movement plus draws until End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const drollCode = "94145021";
    const searcherCode = "923";
    const searchedCode = "924";
    const blockedToHandCode = "925";
    const blockedDrawCode = "926";
    const responderCode = "927";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === drollCode),
      { code: searcherCode, name: "Droll Searcher", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1000 },
      { code: searchedCode, name: "Droll Searched Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: blockedToHandCode, name: "Droll Blocked Search", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: blockedDrawCode, name: "Droll Blocked Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Droll Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 941, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [searcherCode, searchedCode, blockedToHandCode, blockedDrawCode, responderCode] }, 1: { main: [drollCode] } });
    startDuel(session);

    const searcher = session.state.cards.find((card) => card.code === searcherCode);
    const searched = session.state.cards.find((card) => card.code === searchedCode);
    const blockedToHand = session.state.cards.find((card) => card.code === blockedToHandCode);
    const blockedDraw = session.state.cards.find((card) => card.code === blockedDrawCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const droll = session.state.cards.find((card) => card.code === drollCode);
    expect(searcher).toBeDefined();
    expect(searched).toBeDefined();
    expect(blockedToHand).toBeDefined();
    expect(blockedDraw).toBeDefined();
    expect(responder).toBeDefined();
    expect(droll).toBeDefined();
    moveDuelCard(session.state, searcher!.uid, "monsterZone", 0);
    searcher!.position = "faceUpAttack";
    searcher!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, droll!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${searcherCode}.lua`) return searcherScript(searchedCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(searcherCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(drollCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const searchAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === searcher!.uid);
    expect(searchAction).toBeDefined();
    applyAndAssert(session, searchAction!);
    resolveLiveChain(session);
    expect(session.state.cards.find((card) => card.uid === searched!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(host.messages).toContain("droll searcher resolved");
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: searched!.uid }),
        expect.objectContaining({ eventName: "customEvent", eventCode: 0x10000000 + Number(drollCode), eventValue: 0 }),
      ]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    const triggerPlayer = restoredTrigger.session.state.waitingFor;
    expect(triggerPlayer).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, triggerPlayer!)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, triggerPlayer!));
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, triggerPlayer!).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredTrigger, triggerPlayer!));
    const drollAction = getLuaRestoreLegalActions(restoredTrigger, triggerPlayer!).find(
      (action) => (action.type === "activateEffect" || action.type === "activateTrigger") && action.uid === droll!.uid,
    );
    expect(drollAction).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredTrigger, drollAction!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === droll!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTrigger.session.state.chain).toHaveLength(1);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    const responsePlayer = restoredChain.session.state.waitingFor;
    expect(responsePlayer).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restoredChain, responsePlayer!)).toEqual(getGroupedDuelLegalActions(restoredChain.session, responsePlayer!));
    expect(getLuaRestoreLegalActionGroups(restoredChain, responsePlayer!).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, responsePlayer!));
    expect(
      getLuaRestoreLegalActions(restoredChain, responsePlayer!).some((action) => action.type === "activateEffect" && action.uid === responder!.uid),
    ).toBe(true);

    resolveOpenChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === droll!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.host.messages).not.toContain("droll chain responder resolved");
    assertLockProbe(restoredChain, blockedToHandCode, "locked", ["droll can add locked false", "droll add locked 0/0", "droll can draw locked false", "droll draw locked 0/0"]);

    const endTurn = getLuaRestoreLegalActions(restoredChain, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyLuaRestoreResponse(restoredChain, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
    assertLockProbe(restoredChain, blockedToHandCode, "after end", [
      "droll can add after end true",
      "droll add after end 1/1",
      "droll can draw after end true",
      "droll draw after end 1/1",
    ]);
  });
});

function searcherScript(searchedCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_TOHAND)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${searchedCode}), tp, LOCATION_DECK, 0, 1, nil) end
        Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, ${searchedCode}), tp, LOCATION_DECK, 0, 1, 1, nil)
        Duel.SendtoHand(g,nil,REASON_EFFECT)
        Duel.ConfirmCards(1-tp,g)
        Debug.Message("droll searcher resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("droll chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function resolveLiveChain(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.chain.length > 0; index += 1) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
  expect(session.state.chain).toHaveLength(0);
}

function resolveOpenChain(restored: LuaSnapshotRestoreResult): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
  expect(restored.session.state.chain).toHaveLength(0);
}

function assertLockProbe(restored: LuaSnapshotRestoreResult, blockedToHandCode: string, label: string, expected: string[]): void {
  const result = restored.host.loadScript(
    `
    local add=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${blockedToHandCode}), 0, LOCATION_DECK, 0, 1, 1, nil):GetFirst()
    Debug.Message("droll can add ${label} " .. tostring(add:IsAbleToHand()))
    Debug.Message("droll add ${label} " .. Duel.SendtoHand(add,nil,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
    Debug.Message("droll can draw ${label} " .. tostring(Duel.IsPlayerCanDraw(0,1)))
    Debug.Message("droll draw ${label} " .. Duel.Draw(0,1,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
    `,
    `droll-${label.replace(/\\s+/g, "-")}-probe.lua`,
  );
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages).toEqual(expect.arrayContaining(expected));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
