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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Prime Material Dragon reverse damage", () => {
  it("restores Prime Material Dragon and converts real effect damage into recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const primeMaterialCode = "12298909";
    const tremendousFireCode = "46918794";
    const responderCode = "1229";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [primeMaterialCode, tremendousFireCode].includes(card.code)),
      { code: responderCode, name: "Prime Material Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1229, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [primeMaterialCode, tremendousFireCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const primeMaterial = session.state.cards.find((card) => card.code === primeMaterialCode);
    const tremendousFire = session.state.cards.find((card) => card.code === tremendousFireCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(primeMaterial).toBeDefined();
    expect(tremendousFire).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, primeMaterial!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, tremendousFire!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(primeMaterialCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(tremendousFireCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 80,
          sourceUid: primeMaterial!.uid,
          targetRange: [1, 1],
        }),
      ]),
    );

    const fireAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === tremendousFire!.uid);
    expect(fireAction).toBeDefined();
    applyAndAssert(session, fireAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-3-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 524288,
            "count": 0,
            "parameter": 500,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-46918794-1",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 80,
          sourceUid: primeMaterial!.uid,
          targetRange: [1, 1],
        }),
      ]),
    );

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.players[0].lifePoints).toBe(8500);
    expect(restored.session.state.players[1].lifePoints).toBe(9000);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tremendousFire!.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tremendousFire!.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === tremendousFire!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).not.toContain("prime material responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("prime material responder resolved") end)
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
