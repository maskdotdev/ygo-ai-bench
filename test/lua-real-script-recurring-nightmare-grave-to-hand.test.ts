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
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Recurring Nightmare Graveyard to hand", () => {
  it("restores Recurring Nightmare's two Graveyard targets from CHAININFO_TARGET_CARDS and returns only related DARK 0 DEF monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const recurringNightmareCode = "81191584";
    const firstTargetCode = "81191585";
    const secondTargetCode = "81191586";
    const lightDecoyCode = "81191587";
    const highDefenseDecoyCode = "81191588";
    const responderCode = "81191589";
    const script = workspace.readScript(`c${recurringNightmareCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsDefenseBelow(0) and c:IsAttribute(ATTRIBUTE_DARK) and c:IsAbleToHand()");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,2,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,2,2,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,2,0,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("g:Filter(Card.IsRelateToEffect,nil,e)");
    expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === recurringNightmareCode),
      { code: firstTargetCode, name: "Recurring Nightmare First Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 0, attribute: attributeDark },
      { code: secondTargetCode, name: "Recurring Nightmare Second Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 0, attribute: attributeDark },
      { code: lightDecoyCode, name: "Recurring Nightmare LIGHT Decoy", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 0, attribute: attributeLight },
      { code: highDefenseDecoyCode, name: "Recurring Nightmare High DEF Decoy", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 200, attribute: attributeDark },
      { code: responderCode, name: "Recurring Nightmare Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 811, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [recurringNightmareCode, firstTargetCode, secondTargetCode, lightDecoyCode, highDefenseDecoyCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const recurringNightmare = session.state.cards.find((card) => card.code === recurringNightmareCode);
    const firstTarget = session.state.cards.find((card) => card.code === firstTargetCode);
    const secondTarget = session.state.cards.find((card) => card.code === secondTargetCode);
    const lightDecoy = session.state.cards.find((card) => card.code === lightDecoyCode);
    const highDefenseDecoy = session.state.cards.find((card) => card.code === highDefenseDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(recurringNightmare).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    expect(lightDecoy).toBeDefined();
    expect(highDefenseDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, recurringNightmare!.uid, "hand", 0);
    moveDuelCard(session.state, firstTarget!.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, secondTarget!.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, lightDecoy!.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, highDefenseDecoy!.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(recurringNightmareCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const recurringNightmareAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === recurringNightmare!.uid);
    expect(recurringNightmareAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, recurringNightmareAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-81191585-1",
              "p0-deck-81191586-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-81191584-0",
        "targetUids": [
          "p0-deck-81191585-1",
          "p0-deck-81191586-2",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [firstTarget!.uid, secondTarget!.uid], count: 2, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-81191585-1",
              "p0-deck-81191586-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-81191584-0",
        "targetUids": [
          "p0-deck-81191585-1",
          "p0-deck-81191586-2",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [firstTarget!.uid, secondTarget!.uid], count: 2, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === recurringNightmare!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === secondTarget!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === lightDecoy!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === highDefenseDecoy!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: firstTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recurringNightmare!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: secondTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recurringNightmare!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: firstTarget!.uid,
        eventUids: [firstTarget!.uid, secondTarget!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recurringNightmare!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("recurring nightmare responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("recurring nightmare responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
