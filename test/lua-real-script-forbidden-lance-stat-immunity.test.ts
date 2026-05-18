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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Forbidden Lance stat effect", () => {
  it("restores Forbidden Lance's target and applies the ATK loss to battle calculation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lanceCode = "27243130";
    const responderCode = "860";
    const attackerCode = "1100";
    const defenderCode = "1101";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lanceCode),
      { code: responderCode, name: "Forbidden Lance Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: attackerCode, name: "Forbidden Lance Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1200 },
      { code: defenderCode, name: "Forbidden Lance Defender", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 272, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lanceCode, attackerCode] }, 1: { main: [responderCode, defenderCode] } });
    startDuel(session);

    const lance = session.state.cards.find((card) => card.code === lanceCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(lance).toBeDefined();
    expect(responder).toBeDefined();
    expect(attacker).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, lance!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lanceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const lanceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lance!.uid);
    expect(lanceAction).toBeDefined();
    applyAndAssert(session, lanceAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-27243130-0",
        "targetUids": [
          "p0-deck-1100-1",
        ],
      }
    `);
    expect(session.state.cards.find((card) => card.uid === lance!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-27243130-0",
        "targetUids": [
          "p0-deck-1100-1",
        ],
      }
    `);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.cards.find((card) => card.uid === lance!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === attacker!.uid && [1, 100].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 100,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-100",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:27243130:lua-3-100",
          "reset": {
            "flags": 1107169792,
          },
          "sourceUid": "p0-deck-1100-1",
          "target": [Function],
          "value": -800,
        },
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 1,
          "controller": 0,
          "cost": [Function],
          "description": 3104,
          "event": "continuous",
          "id": "lua-4-1",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 67239936,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:27243130:lua-4-1",
          "reset": {
            "flags": 1107169792,
          },
          "sourceUid": "p0-deck-1100-1",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);

    restored.session.state.phase = "battle";
    restored.session.state.waitingFor = 0;
    const attack = getLegalActions(restored.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === defender!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage[0]).toBe(300);
    expect(restored.session.state.players[0].lifePoints).toBe(7700);
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.host.messages).not.toContain("forbidden lance responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("forbidden lance responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
