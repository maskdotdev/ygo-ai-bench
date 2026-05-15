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
const setGishki = 0x3a;
const typeMonster = 0x1;
const typeRitual = 0x80;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Forbidden Arts of the Gishki opponent Ritual materials", () => {
  it("restores positional CreateProc opponent-field materials, release extraop, and ATK halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const forbiddenArtsCode = "28429121";
    const ritualTargetCode = "28421";
    const ownFieldMaterialCode = "28422";
    const opponentFieldMaterialCode = "28423";
    const handDecoyCode = "28424";
    const responderCode = "28425";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === forbiddenArtsCode),
      { code: ritualTargetCode, name: "Forbidden Arts Gishki Ritual Fixture", kind: "monster", typeFlags: typeMonster | typeRitual, level: 6, attack: 2600, defense: 1800, setcodes: [setGishki] },
      { code: ownFieldMaterialCode, name: "Forbidden Arts Own Field Material", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1000, defense: 1000 },
      { code: opponentFieldMaterialCode, name: "Forbidden Arts Opponent Field Material", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1500, defense: 1200 },
      { code: handDecoyCode, name: "Forbidden Arts Hand Decoy", kind: "monster", typeFlags: typeMonster, level: 6, attack: 1700, defense: 1400 },
      { code: responderCode, name: "Forbidden Arts Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 284, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [forbiddenArtsCode, ritualTargetCode, ownFieldMaterialCode, handDecoyCode] }, 1: { main: [opponentFieldMaterialCode, responderCode] } });
    startDuel(session);

    const forbiddenArts = session.state.cards.find((card) => card.code === forbiddenArtsCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const ownFieldMaterial = session.state.cards.find((card) => card.code === ownFieldMaterialCode);
    const opponentFieldMaterial = session.state.cards.find((card) => card.code === opponentFieldMaterialCode);
    const handDecoy = session.state.cards.find((card) => card.code === handDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(forbiddenArts).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(ownFieldMaterial).toBeDefined();
    expect(opponentFieldMaterial).toBeDefined();
    expect(handDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, forbiddenArts!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, ownFieldMaterial!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentFieldMaterial!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, handDecoy!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(forbiddenArtsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === forbiddenArts!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
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
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-28429121-0",
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

    const summonedRitual = restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid);
    expect(summonedRitual).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
    });
    expect(summonedRitual!.summonMaterialUids).toEqual([ownFieldMaterial!.uid, opponentFieldMaterial!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === ownFieldMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.release | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === opponentFieldMaterial!.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.release | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === handDecoy!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === forbiddenArts!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 101 && effect.sourceUid === ritualTarget!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 101,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-4-101",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:28421:lua-4-101",
        "reset": {
          "flags": 16650240,
        },
        "sourceUid": "p0-deck-28421-1",
        "target": [Function],
        "value": 1300,
      }
    `);
    expect(restored.host.messages).not.toContain("forbidden arts responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("forbidden arts responder resolved") end)
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
