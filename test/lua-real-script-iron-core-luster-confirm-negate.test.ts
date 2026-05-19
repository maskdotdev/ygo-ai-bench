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
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Iron Core Luster confirm-cost activation negate", () => {
  it("restores its hidden Iron Core confirmation cost, hand shuffle, activation negation, destruction, and suppressed Spell operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lusterCode = "34545235";
    const ironCoreCode = "36623431";
    const starterSpellCode = "345452350";
    const drawnCode = "345452351";
    const responderCode = "345452352";
    const script = workspace.readScript(`c${lusterCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
    expect(script).toContain("return ep~=tp and re:IsHasType(EFFECT_TYPE_ACTIVATE) and Duel.IsChainNegatable(ev)");
    expect(script).toContain("return c:IsCode(36623431) and not c:IsPublic()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.ShuffleHand(tp)");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lusterCode || card.code === ironCoreCode),
      { code: starterSpellCode, name: "Iron Core Luster Spell Activation", kind: "spell", typeFlags: typeSpell },
      { code: drawnCode, name: "Iron Core Luster Suppressed Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Iron Core Luster Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 34545235, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterSpellCode, drawnCode] }, 1: { main: [lusterCode, ironCoreCode, responderCode] } });
    startDuel(session);

    const luster = requireCard(session, lusterCode);
    const ironCore = requireCard(session, ironCoreCode);
    const starterSpell = requireCard(session, starterSpellCode);
    const drawn = requireCard(session, drawnCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, starterSpell.uid, "spellTrapZone", 0).position = "faceDown";
    starterSpell.faceUp = false;
    moveDuelCard(session.state, luster.uid, "spellTrapZone", 1).position = "faceDown";
    luster.faceUp = false;
    moveDuelCard(session.state, ironCore.uid, "hand", 1);
    ironCore.faceUp = false;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterSpellCode}.lua`) return spellDrawScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [starterSpellCode, lusterCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starterSpell.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
      player: 0,
      sourceUid: starterSpell.uid,
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const lusterAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === luster.uid);
    expect(lusterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 1), null, 2)).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, lusterAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 2,
      effectId: "lua-2-1027",
      id: "chain-3",
      operationInfos: [
        { category: 0x10000000, targetUids: [starterSpell.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [starterSpell.uid], count: 1, player: 0, parameter: 0 },
      ],
      player: 1,
      sourceUid: luster.uid,
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expectCleanRestore(restoredPendingResolution);
    expectRestoredLegalActions(restoredPendingResolution, restoredPendingResolution.session.state.waitingFor ?? 0);
    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starterSpell.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === luster.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === ironCore.uid)).toMatchObject({ location: "hand", controller: 1, faceUp: false });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredPendingResolution.host.promptDecisions).toEqual([]);
    expect(restoredPendingResolution.host.messages).not.toContain("iron core luster spell resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("iron core luster chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["confirmed", "destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: ironCore.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [ironCore.uid],
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starterSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: luster.uid,
        eventReasonEffectId: 2,
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
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventPlayer === 0 && event.eventUids?.includes(drawn.uid))).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredPendingResolution.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, restoredResolved.session.state.waitingFor ?? restoredResolved.session.state.turnPlayer);
    expect(restoredResolved.session.state.chain).toHaveLength(0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === ironCore.uid)).toMatchObject({ location: "hand", controller: 1, faceUp: false });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredResolved.host.messages).not.toContain("iron core luster spell resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function spellDrawScript(): string {
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
        Debug.Message("iron core luster spell resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("iron core luster chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
