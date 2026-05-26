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
const hasHeadJudgingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c38143903.lua"));
const headJudgingCode = "38143903";
const starterCode = "381439030";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const categoryCoin = 0x1000000;
const categoryToGrave = 0x20;
const categoryNegate = 0x10000000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasHeadJudgingScript)("Lua real script Head Judging coin negate control", () => {
  it("restores monster-effect response into called coin, negated activation, and control steal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${headJudgingCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_COIN+CATEGORY_TOGRAVE+CATEGORY_NEGATE+CATEGORY_CONTROL)");
    expect(script).toContain("return re:IsMonsterEffect() and Duel.IsChainNegatable(ev)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,rp,1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,c,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,re:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,re:GetHandler(),1,0,0)");
    expect(script).toContain("if Duel.CallCoin(p) then");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.GetControl(re:GetHandler(),1-p)");

    const cards: DuelCardData[] = [
      { code: headJudgingCode, name: "Head Judging", kind: "trap", typeFlags: typeTrap },
      { code: starterCode, name: "Head Judging Monster Effect Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [headJudgingCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const headJudging = requireCard(session, headJudgingCode);
    const starter = requireCard(session, starterCode);
    moveDuelCard(session.state, headJudging.uid, "spellTrapZone", 0);
    headJudging.position = "faceUpAttack";
    headJudging.faceUp = true;
    moveDuelCard(session.state, starter.uid, "monsterZone", 1);
    starter.position = "faceUpAttack";
    starter.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterMonsterEffectScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(headJudgingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "monsterZone",
        activationSequence: 0,
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const response = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === headJudging.uid);
    expect(response, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, response!);
    expect(restoredResponse.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "monsterZone",
        activationSequence: 0,
      },
      {
        id: "chain-3",
        chainIndex: 2,
        effectId: "lua-2-1027",
        sourceUid: headJudging.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        eventName: "chaining",
        eventCode: 1027,
        eventPlayer: 1,
        eventCardUid: starter.uid,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: categoryCoin, count: 0, parameter: 1, player: 1, targetUids: [] },
          { category: categoryToGrave, count: 1, parameter: 0, player: 0, targetUids: [headJudging.uid] },
          { category: categoryNegate, count: 1, parameter: 0, player: 0, targetUids: [starter.uid] },
          { category: categoryControl, count: 1, parameter: 0, player: 0, targetUids: [starter.uid] },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChain.session.state.lastCoinResults).toEqual([0]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: headJudging.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === headJudging.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["coinTossed", "chainNegated", "chainDisabled", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 1,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: headJudging.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: headJudging.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
    ]);
    expect(restoredChain.host.messages).not.toContain("head judging starter resolved");
  });
});

function starterMonsterEffectScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Debug.Message("head judging starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}
