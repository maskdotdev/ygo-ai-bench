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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Xyz Gift overlay draw", () => {
  it("restores Xyz Gift after detaching two Xyz materials and drawing two cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const xyzGiftCode = "72355441";
    const firstXyzCode = "72355442";
    const secondXyzCode = "72355443";
    const firstMaterialCode = "72355444";
    const secondMaterialCode = "72355445";
    const firstDrawCode = "72355446";
    const secondDrawCode = "72355447";
    const responderCode = "72355448";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === xyzGiftCode),
      { code: firstXyzCode, name: "Xyz Gift First Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 2000, defense: 1600 },
      { code: secondXyzCode, name: "Xyz Gift Second Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 1900, defense: 1800 },
      { code: firstMaterialCode, name: "Xyz Gift First Material", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: secondMaterialCode, name: "Xyz Gift Second Material", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: firstDrawCode, name: "Xyz Gift First Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: secondDrawCode, name: "Xyz Gift Second Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Xyz Gift Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 723, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [xyzGiftCode, firstMaterialCode, secondMaterialCode, firstDrawCode, secondDrawCode], extra: [firstXyzCode, secondXyzCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const xyzGift = requireCard(session, xyzGiftCode);
    const firstXyz = requireCard(session, firstXyzCode);
    const secondXyz = requireCard(session, secondXyzCode);
    const firstMaterial = requireCard(session, firstMaterialCode);
    const secondMaterial = requireCard(session, secondMaterialCode);
    const firstDraw = requireCard(session, firstDrawCode);
    const secondDraw = requireCard(session, secondDrawCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, xyzGift.uid, "hand", 0);
    moveDuelCard(session.state, firstXyz.uid, "monsterZone", 0);
    firstXyz.position = "faceUpAttack";
    firstXyz.faceUp = true;
    moveDuelCard(session.state, secondXyz.uid, "monsterZone", 0);
    secondXyz.position = "faceUpAttack";
    secondXyz.faceUp = true;
    moveDuelCard(session.state, firstMaterial.uid, "overlay", 0);
    moveDuelCard(session.state, secondMaterial.uid, "overlay", 0);
    firstXyz.overlayUids.push(firstMaterial.uid, secondMaterial.uid);
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
    expect(host.loadCardScript(Number(xyzGiftCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const xyzGiftAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === xyzGift.uid);
    expect(xyzGiftAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, xyzGiftAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    const restoredPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expect(getLuaRestoreLegalActionGroups(restored, restoredPlayer)).toEqual(getGroupedDuelLegalActions(restored.session, restoredPlayer));
    expect(getLuaRestoreLegalActionGroups(restored, restoredPlayer).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, restoredPlayer));
    expect(restored.session.state.chain).toHaveLength(1);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.chain).toHaveLength(0);

    expect(restored.session.state.cards.find((card) => card.uid === xyzGift.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === firstXyz.uid)).toMatchObject({ location: "monsterZone", overlayUids: [] });
    expect(restored.session.state.cards.find((card) => card.uid === secondXyz.uid)).toMatchObject({ location: "monsterZone", overlayUids: [] });
    expect(restored.session.state.cards.find((card) => card.uid === firstMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: xyzGift.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === secondMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: xyzGift.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === firstDraw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === secondDraw.uid)).toMatchObject({ location: "hand", controller: 0 });
    const detachedEvents = restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial");
    expect(detachedEvents).toHaveLength(3);
    expect(detachedEvents.filter((event) => event.eventUids !== undefined)).toMatchObject([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: firstMaterial.uid,
        eventUids: [firstMaterial.uid, secondMaterial.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: xyzGift.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: secondDraw.uid,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [secondDraw.uid, firstDraw.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: xyzGift.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("xyz gift responder resolved");
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(false);
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
      e:SetOperation(function(e,tp) Debug.Message("xyz gift responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
