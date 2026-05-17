import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const counterSeason = 0x214;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Spring multi-zone disable prompt", () => {
  it("restores repeated SelectDisableField and SelectYesNo prompts into Season Counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const springCode = "60600821";
    const responderCode = "60600822";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === springCode),
      { code: responderCode, name: "Spring Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6060, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [springCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const spring = requireCard(session, springCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, spring.uid, "spellTrapZone", 0).sequence = 5;
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
    expect(host.loadCardScript(Number(springCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const ignition = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === spring.uid);
    expect(ignition, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, ignition!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 5,
        "chainIndex": 1,
        "effectId": "lua-3",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8388608,
            "count": 5,
            "parameter": 532,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-60600821-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.promptDecisions).toEqual([
      expect.objectContaining({ api: "SelectDisableField", player: 0, options: [1, 2, 4, 8, 16], returned: 1 }),
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
      expect.objectContaining({ api: "SelectDisableField", player: 0, options: [2, 4, 8, 16], returned: 2 }),
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
      expect.objectContaining({ api: "SelectDisableField", player: 0, options: [4, 8, 16], returned: 4 }),
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
      expect.objectContaining({ api: "SelectDisableField", player: 0, options: [8, 16], returned: 8 }),
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
      expect.objectContaining({ api: "SelectDisableField", player: 0, options: [16], returned: 16 }),
    ]);

    const restoredSpring = restored.session.state.cards.find((card) => card.uid === spring.uid);
    expect(getDuelCardCounter(restoredSpring, counterSeason)).toBe(5);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === spring.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: spring.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "spellTrapZone", sequence: 5, position: "faceDown", faceUp: true },
        eventReason: 0x40,
        eventReasonCardUid: spring.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 0,
      },
    ]);
    const disableFieldEffect = restored.session.state.effects.find((effect) => effect.code === 260 && effect.sourceUid === spring.uid);
    expect(disableFieldEffect).toMatchObject({
      code: 260,
      sourceUid: spring.uid,
      range: ["spellTrapZone"],
      value: 31,
    });
    expect(availableMonsterZoneCount(restored.session, 0, [])).toBe(0);
    expect(restored.host.messages).not.toContain("spring responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("spring responder resolved") end)
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
