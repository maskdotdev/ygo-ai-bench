import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gishki Psychelone AnnounceRace and AnnounceAttribute", () => {
  it("restores announced race and attribute labels into the opponent hand shuffle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const psycheloneCode = "30334522";
    const matchingHandCode = "30334523";
    const responderCode = "30334524";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === psycheloneCode),
      { code: matchingHandCode, name: "Announced Warrior Earth Witness", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: raceWarrior, attribute: attributeEarth },
      { code: responderCode, name: "Gishki Psychelone Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: raceWarrior, attribute: attributeEarth },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 303, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [psycheloneCode] }, 1: { main: [matchingHandCode, responderCode] } });
    startDuel(session);

    const psychelone = requireCard(session, psycheloneCode);
    const matchingHand = requireCard(session, matchingHandCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, psychelone.uid, "monsterZone", 0);
    moveDuelCard(session.state, matchingHand.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(psycheloneCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const ignition = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === psychelone.uid);
    expect(ignition, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, ignition!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2",
        "effectLabel": 1,
        "effectLabels": [
          1,
          1,
        ],
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-30334522-0",
      }
    `);
    expect(host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "AnnounceRace", player: 0, options: expect.arrayContaining([raceWarrior]), returned: raceWarrior }),
      expect.objectContaining({ api: "AnnounceAttribute", player: 0, options: expect.arrayContaining([attributeEarth]), returned: attributeEarth }),
    ]));
    expect(session.state.cards.find((card) => card.uid === matchingHand.uid)).toMatchObject({ location: "hand", controller: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chain[0]).toMatchObject({
      effectLabel: raceWarrior,
      effectLabels: [raceWarrior, attributeEarth],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    const opponentHandCards = [matchingHand.uid, responder.uid].map((uid) => restored.session.state.cards.find((card) => card.uid === uid));
    expect(opponentHandCards.filter((card) => card?.location === "deck")).toHaveLength(1);
    expect(restored.session.state.cards.find((card) => card.uid === psychelone.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.host.messages).not.toContain("gishki psychelone responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("gishki psychelone responder resolved") end)
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
