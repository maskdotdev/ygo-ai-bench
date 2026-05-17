import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Small Scuffle mirrored field-zone summon", () => {
  it("restores SelectFieldZone target param into mirrored Special Summon zones", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const scuffleCode = "15967552";
    const ownLowLevelCode = "15967553";
    const opponentLowLevelCode = "15967554";
    const responderCode = "15967555";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === scuffleCode),
      { code: ownLowLevelCode, name: "Small Scuffle Own Level 2", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 800, defense: 800 },
      { code: opponentLowLevelCode, name: "Small Scuffle Opponent Level 2", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 900, defense: 900 },
      { code: responderCode, name: "Small Scuffle Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1596, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scuffleCode, ownLowLevelCode] }, 1: { main: [opponentLowLevelCode, responderCode] } });
    startDuel(session);

    const scuffle = requireCard(session, scuffleCode);
    const ownLowLevel = requireCard(session, ownLowLevelCode);
    const opponentLowLevel = requireCard(session, opponentLowLevelCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, scuffle.uid, "spellTrapZone", 0);
    scuffle.faceUp = false;
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
    expect(host.loadCardScript(Number(scuffleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredActivation, 0));

    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === scuffle.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredActivation, activate!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restoredActivation.host.promptDecisions).toEqual([
      expect.objectContaining({
        api: "SelectFieldZone",
        player: 0,
        options: [1, 2, 4, 8, 16],
        returned: 1,
      }),
    ]);
    expect(restoredActivation.session.state.chain).toHaveLength(1);
    expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 3,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "possibleOperationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 3,
            "player": 1,
            "targetUids": [],
          },
        ],
        "sourceUid": "p0-deck-15967552-0",
        "targetParam": 1,
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 1, returned: true }),
    ]));
    expect(restored.session.state.cards.find((card) => card.uid === ownLowLevel.uid)).toMatchObject({ location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentLowLevel.uid)).toMatchObject({ location: "monsterZone", controller: 1, sequence: 4, position: "faceUpAttack" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => event.eventUids)).toEqual([
      [ownLowLevel.uid],
      [opponentLowLevel.uid],
    ]);
    expect(restored.host.messages).not.toContain("small scuffle responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("small scuffle responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
