import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Solemn Judgment summon negation", () => {
    it("restores Solemn Judgment's Spell activation negation, LP-half cost, and source destruction", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const solemnCode = "41420027";
      const starterCode = "936";
      const drawnCode = "937";
      const responderCode = "938";
      const cards: DuelCardData[] = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solemnCode),
        { code: starterCode, name: "Solemn Judgment Draw Spell", kind: "spell", typeFlags: 0x2 },
        { code: drawnCode, name: "Solemn Judgment Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
        { code: responderCode, name: "Solemn Judgment Spell Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 482, startingHandSize: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [starterCode, drawnCode, responderCode] }, 1: { main: [solemnCode] } });
      startDuel(session);

      const starter = session.state.cards.find((card) => card.code === starterCode);
      const drawn = session.state.cards.find((card) => card.code === drawnCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      const solemn = session.state.cards.find((card) => card.code === solemnCode);
      expect(starter).toBeDefined();
      expect(drawn).toBeDefined();
      expect(responder).toBeDefined();
      expect(solemn).toBeDefined();
      moveDuelCard(session.state, starter!.uid, "hand", 0);
      moveDuelCard(session.state, responder!.uid, "hand", 0);
      moveDuelCard(session.state, solemn!.uid, "spellTrapZone", 1);
      solemn!.position = "faceDown";
      solemn!.faceUp = false;
      session.state.phase = "main1";
      session.state.waitingFor = 0;

      const source = {
        readScript(name: string) {
          if (name === `c${starterCode}.lua`) return drawSpellScript();
          if (name === `c${responderCode}.lua`) return chainResponderScript();
          return workspace.readScript(name);
        },
      };
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(solemnCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(3);

      const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
      expect(starterAction).toBeDefined();
      applyAndAssert(session, starterAction!);
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
              "category": 65536,
              "count": 0,
              "parameter": 1,
              "player": 0,
              "targetUids": [],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-936-0",
        }
      `);

      const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
      expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
      expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpenChain.session, 1));
      expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpenChain, 1));
      const solemnAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === solemn!.uid);
      expect(solemnAction).toBeDefined();
      const chained = applyLuaRestoreResponse(restoredOpenChain, solemnAction!);
      expect(chained.ok, chained.error).toBe(true);
      expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(4000);
      expectSolemnCost(restoredOpenChain.session, solemn!.uid, 6);
      expect(restoredOpenChain.session.state.chain).toHaveLength(0);
      expect(restoredOpenChain.session.state.chain[1]).toMatchInlineSnapshot(`undefined`);

      const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
      expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
      expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
      expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
      expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

      for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
        const passPlayer = restoredPendingResolution.session.state.waitingFor;
        expect(passPlayer).toBeDefined();
        const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
        expect(pass).toBeDefined();
        const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
        expect(resolved.ok, resolved.error).toBe(true);
      }

      expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
      expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(4000);
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starter!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === solemn!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "deck" });
      expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment draw spell resolved");
      expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment chain responder resolved");
      expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
        {
          eventName: "destroyed",
          eventCode: 1029,
          eventCardUid: starter!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 1,
          eventReasonCardUid: solemn!.uid,
          eventReasonEffectId: 6,
          eventPreviousState: {
            controller: 0,
            faceUp: true,
            location: "spellTrapZone",
            position: "faceDown",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "graveyard",
            position: "faceDown",
            sequence: 0,
          },
        },
        {
          eventName: "chainNegated",
          eventCode: 1024,
          eventPlayer: 0,
          eventValue: 1,
          eventReasonPlayer: 0,
          eventChainDepth: 1,
          eventChainLinkId: "chain-2",
          relatedEffectId: 1,
        },
        {
          eventName: "chainDisabled",
          eventCode: 1025,
          eventPlayer: 0,
          eventValue: 1,
          eventReasonPlayer: 0,
          eventChainDepth: 1,
          eventChainLinkId: "chain-2",
          relatedEffectId: 1,
        },
      ]);
      expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventPlayer === 0 && event.eventUids?.includes(drawn!.uid))).toEqual([]);
    });

    it("restores Solemn Judgment's Trap activation negation, LP-half cost, and source destruction", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const solemnCode = "41420027";
      const starterCode = "956";
      const drawnCode = "957";
      const responderCode = "958";
      const cards: DuelCardData[] = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solemnCode),
        { code: starterCode, name: "Solemn Judgment Draw Trap", kind: "trap", typeFlags: 0x4 },
        { code: drawnCode, name: "Solemn Judgment Trap Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
        { code: responderCode, name: "Solemn Judgment Trap Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 485, startingHandSize: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [starterCode, drawnCode, responderCode] }, 1: { main: [solemnCode] } });
      startDuel(session);

      const starter = session.state.cards.find((card) => card.code === starterCode);
      const drawn = session.state.cards.find((card) => card.code === drawnCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      const solemn = session.state.cards.find((card) => card.code === solemnCode);
      expect(starter).toBeDefined();
      expect(drawn).toBeDefined();
      expect(responder).toBeDefined();
      expect(solemn).toBeDefined();
      moveDuelCard(session.state, starter!.uid, "spellTrapZone", 0);
      starter!.position = "faceDown";
      starter!.faceUp = false;
      moveDuelCard(session.state, responder!.uid, "hand", 0);
      moveDuelCard(session.state, solemn!.uid, "spellTrapZone", 1);
      solemn!.position = "faceDown";
      solemn!.faceUp = false;
      session.state.phase = "main1";
      session.state.waitingFor = 0;

      const source = {
        readScript(name: string) {
          if (name === `c${starterCode}.lua`) return drawTrapScript();
          if (name === `c${responderCode}.lua`) return chainResponderScript();
          return workspace.readScript(name);
        },
      };
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(solemnCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(3);

      const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
      expect(starterAction).toBeDefined();
      applyAndAssert(session, starterAction!);
      expect(session.state.chain).toHaveLength(1);
      expect(session.state.chain[0]).toMatchInlineSnapshot(`
        {
          "activationLocation": "spellTrapZone",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-1-1002",
          "id": "chain-2",
          "operationInfos": [
            {
              "category": 65536,
              "count": 0,
              "parameter": 1,
              "player": 0,
              "targetUids": [],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-956-0",
        }
      `);

      const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
      expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
      expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpenChain.session, 1));
      expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpenChain, 1));
      const solemnAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === solemn!.uid);
      expect(solemnAction).toBeDefined();
      const chained = applyLuaRestoreResponse(restoredOpenChain, solemnAction!);
      expect(chained.ok, chained.error).toBe(true);
      expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(4000);
      expectSolemnCost(restoredOpenChain.session, solemn!.uid, 6);
      expect(restoredOpenChain.session.state.chain).toHaveLength(0);
      expect(restoredOpenChain.session.state.chain[1]).toMatchInlineSnapshot(`undefined`);

      const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
      expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
      expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
      expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
      expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

      for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
        const passPlayer = restoredPendingResolution.session.state.waitingFor;
        expect(passPlayer).toBeDefined();
        const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
        expect(pass).toBeDefined();
        const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
        expect(resolved.ok, resolved.error).toBe(true);
      }

      expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
      expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(4000);
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starter!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === solemn!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "deck" });
      expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment draw trap resolved");
      expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment chain responder resolved");
      expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
        {
          eventName: "destroyed",
          eventCode: 1029,
          eventCardUid: starter!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 1,
          eventReasonCardUid: solemn!.uid,
          eventReasonEffectId: 6,
          eventPreviousState: {
            controller: 0,
            faceUp: true,
            location: "spellTrapZone",
            position: "faceDown",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "graveyard",
            position: "faceDown",
            sequence: 0,
          },
        },
        {
          eventName: "chainNegated",
          eventCode: 1024,
          eventPlayer: 0,
          eventValue: 1,
          eventReasonPlayer: 0,
          eventChainDepth: 1,
          eventChainLinkId: "chain-2",
          relatedEffectId: 1,
        },
        {
          eventName: "chainDisabled",
          eventCode: 1025,
          eventPlayer: 0,
          eventValue: 1,
          eventReasonPlayer: 0,
          eventChainDepth: 1,
          eventChainLinkId: "chain-2",
          relatedEffectId: 1,
        },
      ]);
      expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventPlayer === 0 && event.eventUids?.includes(drawn!.uid))).toEqual([]);
    });
});

function drawSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("solemn judgment draw spell resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function drawTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("solemn judgment draw trap resolved")
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
      e:SetOperation(function(e,tp) Debug.Message("solemn judgment chain responder resolved") end)
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
  return response;
}

function expectSolemnCost(session: DuelSession, solemnUid: string, effectId: number) {
  expect(session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
    {
      eventName: "lifePointCostPaid",
      eventCode: 1201,
      eventPlayer: 1,
      eventValue: 4000,
      eventReason: duelReason.cost,
      eventReasonPlayer: 1,
      eventReasonCardUid: solemnUid,
      eventReasonEffectId: effectId,
    },
  ]);
}
