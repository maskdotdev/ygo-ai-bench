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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shrink base attack", () => {
  it("restores Shrink's target and applies base ATK halving to battle calculation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shrinkCode = "55713623";
    const responderCode = "860";
    const attackerCode = "1110";
    const defenderCode = "1111";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shrinkCode),
      { code: responderCode, name: "Shrink Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: attackerCode, name: "Shrink Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1200 },
      { code: defenderCode, name: "Shrink Defender", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 557, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shrinkCode, attackerCode] }, 1: { main: [responderCode, defenderCode] } });
    startDuel(session);

    const shrink = session.state.cards.find((card) => card.code === shrinkCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(shrink).toBeDefined();
    expect(responder).toBeDefined();
    expect(attacker).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, shrink!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shrinkCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const shrinkAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === shrink!.uid);
    expect(shrinkAction).toBeDefined();
    applyAndAssert(session, shrinkAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-55713623-0",
        "targetUids": [
          "p0-deck-1110-1",
        ],
      }
    `);
    expect(session.state.cards.find((card) => card.uid === shrink!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    expect(restoredChain.session.state.chain).toHaveLength(1);
    expect(restoredChain.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-55713623-0",
        "targetUids": [
          "p0-deck-1110-1",
        ],
      }
    `);

    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.cards.find((card) => card.uid === shrink!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 103 && effect.sourceUid === attacker!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 103,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-3-103",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:1110:lua-3-103",
        "reset": {
          "flags": 1107169792,
        },
        "sourceUid": "p0-deck-1110-1",
        "target": [Function],
        "value": 1000,
      }
    `);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expect(restoredBattle.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 103 && effect.sourceUid === attacker!.uid)).toMatchInlineSnapshot(`
      {
        "code": 103,
        "controller": 0,
        "event": "continuous",
        "id": "lua-3-103",
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:1110:lua-3-103",
        "reset": {
          "flags": 1107169792,
        },
        "sourceUid": "p0-deck-1110-1",
        "value": 1000,
      }
    `);
    moveDuelCard(restoredBattle.session.state, defender!.uid, "monsterZone", 1).position = "faceUpAttack";
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;

    const attack = getLegalActions(restoredBattle.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === defender!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(restoredBattle.session, attack!);
    passBattleResponses(restoredBattle.session);
    expect(restoredBattle.session.state.battleDamage[0]).toBe(500);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredBattle.host.messages).not.toContain("shrink responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("shrink responder resolved") end)
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
