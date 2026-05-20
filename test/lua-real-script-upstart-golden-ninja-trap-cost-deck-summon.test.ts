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
const hasUpstartGoldenNinjaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c58911105.lua"));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setNinja = 0x2b;

describe.skipIf(!hasUpstreamScripts || !hasUpstartGoldenNinjaScript)("Lua real script Upstart Golden Ninja trap cost Deck summon", () => {
  it("restores Trap cost send-to-Graveyard and Ninja Special Summon from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const upstartCode = "58911105";
    const trapCostCode = "58911106";
    const ninjaTargetCode = "58911107";
    const highLevelNinjaDecoyCode = "58911108";
    const offSetLowLevelDecoyCode = "58911109";
    const responderCode = "58911110";
    const script = workspace.readScript(`c${upstartCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_SET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsTrap() and c:IsAbleToGraveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(cg,REASON_COST)");
    expect(script).toContain("return c:IsLevelBelow(4) and c:IsSetCard(SET_NINJA)");
    expect(script).toContain("c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_DEFENSE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_DEFENSE)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");

    const cards: DuelCardData[] = [
      { code: upstartCode, name: "Upstart Golden Ninja", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNinja], level: 4, attack: 500, defense: 1800 },
      { code: trapCostCode, name: "Upstart Golden Ninja Trap Cost", kind: "trap", typeFlags: typeTrap },
      { code: ninjaTargetCode, name: "Upstart Golden Ninja Level 4 Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNinja], level: 4, attack: 1200, defense: 1200 },
      { code: highLevelNinjaDecoyCode, name: "Upstart Golden Ninja High-Level Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNinja], level: 5, attack: 1800, defense: 1600 },
      { code: offSetLowLevelDecoyCode, name: "Upstart Golden Ninja Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Upstart Golden Ninja Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 58911105, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [upstartCode, trapCostCode, ninjaTargetCode, highLevelNinjaDecoyCode, offSetLowLevelDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const upstart = requireCard(session, upstartCode);
    const trapCost = requireCard(session, trapCostCode);
    const ninjaTarget = requireCard(session, ninjaTargetCode);
    const highLevelNinjaDecoy = requireCard(session, highLevelNinjaDecoyCode);
    const offSetLowLevelDecoy = requireCard(session, offSetLowLevelDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, upstart.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, trapCost.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(upstartCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === upstart.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === trapCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonCardUid: upstart.uid,
    });
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-3",
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 1 }],
      player: 0,
      sourceUid: upstart.uid,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restored);

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.cards.find((card) => card.uid === upstart.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === trapCost.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ninjaTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === highLevelNinjaDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === offSetLowLevelDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.host.messages).not.toContain("upstart golden ninja responder resolved");
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === trapCost.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: trapCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: upstart.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
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
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === ninjaTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: ninjaTarget.uid,
        eventUids: [ninjaTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: upstart.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 4,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("upstart golden ninja responder resolved") end)
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
