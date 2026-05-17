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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Heavy Storm group destroy", () => {
  it("restores Heavy Storm's non-targeting all-field Spell/Trap group destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const heavyStormCode = "19613556";
    const ownBackrowCode = "19613557";
    const opponentTrapCode = "19613558";
    const opponentSpellCode = "19613559";
    const opponentMonsterCode = "19613560";
    const responderCode = "19613561";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heavyStormCode),
      { code: ownBackrowCode, name: "Heavy Storm Ally Backrow", kind: "trap", typeFlags: 0x4 },
      { code: opponentTrapCode, name: "Heavy Storm Opponent Trap", kind: "trap", typeFlags: 0x4 },
      { code: opponentSpellCode, name: "Heavy Storm Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: opponentMonsterCode, name: "Heavy Storm Opponent Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Heavy Storm Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 196, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heavyStormCode, ownBackrowCode] }, 1: { main: [opponentTrapCode, opponentSpellCode, opponentMonsterCode, responderCode] } });
    startDuel(session);

    const heavyStorm = session.state.cards.find((card) => card.code === heavyStormCode);
    const ownBackrow = session.state.cards.find((card) => card.code === ownBackrowCode);
    const opponentTrap = session.state.cards.find((card) => card.code === opponentTrapCode);
    const opponentSpell = session.state.cards.find((card) => card.code === opponentSpellCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(heavyStorm).toBeDefined();
    expect(ownBackrow).toBeDefined();
    expect(opponentTrap).toBeDefined();
    expect(opponentSpell).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, heavyStorm!.uid, "hand", 0);
    moveDuelCard(session.state, ownBackrow!.uid, "spellTrapZone", 0);
    ownBackrow!.position = "faceDown";
    ownBackrow!.faceUp = false;
    moveDuelCard(session.state, opponentTrap!.uid, "spellTrapZone", 1);
    opponentTrap!.position = "faceDown";
    opponentTrap!.faceUp = false;
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 1);
    opponentSpell!.position = "faceUpAttack";
    opponentSpell!.faceUp = true;
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(heavyStormCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const heavyStormAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === heavyStorm!.uid);
    expect(heavyStormAction).toBeDefined();
    applyAndAssert(session, heavyStormAction!);
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
            "category": 1,
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-19613557-1",
              "p1-deck-19613558-0",
              "p1-deck-19613559-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-19613556-0",
      }
    `);
    expect(sortedUids(session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([
      ownBackrow!.uid,
      opponentTrap!.uid,
      opponentSpell!.uid,
    ]));

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
        "operationInfos": [
          {
            "category": 1,
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-19613557-1",
              "p1-deck-19613558-0",
              "p1-deck-19613559-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-19613556-0",
      }
    `);
    expect(sortedUids(restored.session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([
      ownBackrow!.uid,
      opponentTrap!.uid,
      opponentSpell!.uid,
    ]));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === heavyStorm!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownBackrow!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentTrap!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSpell!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownBackrow!.uid,
        eventPreviousState: {
          location: "spellTrapZone",
          controller: 0,
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceDown",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: heavyStorm!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentTrap!.uid,
        eventPreviousState: {
          location: "spellTrapZone",
          controller: 1,
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceDown",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: heavyStorm!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentSpell!.uid,
        eventPreviousState: {
          location: "spellTrapZone",
          controller: 1,
          sequence: 1,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 1,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: heavyStorm!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownBackrow!.uid,
        eventUids: [ownBackrow!.uid, opponentTrap!.uid, opponentSpell!.uid],
        eventPreviousState: {
          location: "spellTrapZone",
          controller: 0,
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceDown",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: heavyStorm!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("heavy storm responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("heavy storm responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sortedUids(uids: string[]): string[] {
  return [...uids].sort();
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
