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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Totem Pole change damage", () => {
  it("restores Totem Pole and doubles real effect damage after snapshot restore", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const totemPoleCode = "47873397";
    const tremendousFireCode = "46918794";
    const rockCodes = ["47871", "47872", "47873"];
    const responderCode = "47874";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [totemPoleCode, tremendousFireCode].includes(card.code)),
      ...rockCodes.map((code, index) => ({ code, name: `Totem Pole Rock ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, attack: 0, defense: 0, level: 4, race: 0x100 })),
      { code: responderCode, name: "Totem Pole Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4787, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [totemPoleCode, tremendousFireCode, ...rockCodes] }, 1: { main: [responderCode] } });
    startDuel(session);

    const totemPole = session.state.cards.find((card) => card.code === totemPoleCode);
    const tremendousFire = session.state.cards.find((card) => card.code === tremendousFireCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const rocks = rockCodes.map((code) => session.state.cards.find((card) => card.code === code));
    expect(totemPole).toBeDefined();
    expect(tremendousFire).toBeDefined();
    expect(responder).toBeDefined();
    for (const rock of rocks) expect(rock).toBeDefined();
    moveDuelCard(session.state, totemPole!.uid, "graveyard", 0);
    moveDuelCard(session.state, tremendousFire!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    for (const rock of rocks) moveDuelCard(session.state, rock!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(totemPoleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(tremendousFireCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const totemAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === totemPole!.uid);
    expect(totemAction).toBeDefined();
    applyAndAssert(session, totemAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === totemPole!.uid)).toMatchObject({ location: "banished", controller: 0 });

    const totemRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(totemRestored.restoreComplete, totemRestored.incompleteReasons.join("; ")).toBe(true);
    expect(totemRestored.missingRegistryKeys).toEqual([]);
    expect(totemRestored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(totemRestored, 1)).toEqual(getGroupedDuelLegalActions(totemRestored.session, 1));
    expect(getLuaRestoreLegalActionGroups(totemRestored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(totemRestored, 1));
    const totemPass = getLuaRestoreLegalActions(totemRestored, 1).find((action) => action.type === "passChain");
    expect(totemPass).toBeDefined();
    expect(applyLuaRestoreResponse(totemRestored, totemPass!).ok).toBe(true);
    expect(totemRestored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 82,
          controller: 0,
          sourceUid: totemPole!.uid,
          targetRange: [0, 1],
        }),
      ]),
    );
    expect(serializeDuel(totemRestored.session).state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 82, luaValueDescriptor: "change-damage:effect-double" })]),
    );

    const fireAction = getLegalActions(totemRestored.session, 0).find((action) => action.type === "activateEffect" && action.uid === tremendousFire!.uid);
    expect(fireAction).toBeDefined();
    applyAndAssert(totemRestored.session, fireAction!);
    expect(totemRestored.session.state.chain).toHaveLength(1);
    expect(totemRestored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-7-1002",
        "id": "chain-5",
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

    const fireRestored = restoreDuelWithLuaScripts(serializeDuel(totemRestored.session), source, reader);
    expect(fireRestored.restoreComplete, fireRestored.incompleteReasons.join("; ")).toBe(true);
    expect(fireRestored.missingRegistryKeys).toEqual([]);
    expect(fireRestored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(fireRestored, 1)).toEqual(getGroupedDuelLegalActions(fireRestored.session, 1));
    expect(getLuaRestoreLegalActionGroups(fireRestored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(fireRestored, 1));
    expect(fireRestored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 82,
          controller: 0,
          sourceUid: totemPole!.uid,
          targetRange: [0, 1],
        }),
      ]),
    );

    const firePass = getLuaRestoreLegalActions(fireRestored, 1).find((action) => action.type === "passChain");
    expect(firePass).toBeDefined();
    const resolved = applyLuaRestoreResponse(fireRestored, firePass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(fireRestored.session.state.players[0].lifePoints).toBe(7500);
    expect(fireRestored.session.state.players[1].lifePoints).toBe(6000);
    expect(fireRestored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 2000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tremendousFire!.uid,
        eventReasonEffectId: 7,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tremendousFire!.uid,
        eventReasonEffectId: 7,
      },
    ]);
    expect(fireRestored.session.state.cards.find((card) => card.uid === tremendousFire!.uid)).toMatchObject({ location: "graveyard" });
    expect(fireRestored.host.messages).not.toContain("totem pole responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("totem pole responder resolved") end)
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
