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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hammer Shot maximum attack destroy", () => {
  it("restores Hammer Shot's maximum-ATK all-field attack-position destroy operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hammerShotCode = "26412047";
    const ownHighAttackCode = "26412048";
    const ownDefenseCode = "26412049";
    const opponentLowAttackCode = "26412050";
    const opponentDefenseCode = "26412051";
    const responderCode = "26412052";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hammerShotCode),
      { code: ownHighAttackCode, name: "Hammer Shot Own High Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 2600, defense: 1200 },
      { code: ownDefenseCode, name: "Hammer Shot Own Defense Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 3000, defense: 1000 },
      { code: opponentLowAttackCode, name: "Hammer Shot Opponent Attack Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: opponentDefenseCode, name: "Hammer Shot Opponent Defense Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 3200, defense: 2400 },
      { code: responderCode, name: "Hammer Shot Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 264, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hammerShotCode, ownHighAttackCode, ownDefenseCode] }, 1: { main: [opponentLowAttackCode, opponentDefenseCode, responderCode] } });
    startDuel(session);

    const hammerShot = session.state.cards.find((card) => card.code === hammerShotCode);
    const ownHighAttack = session.state.cards.find((card) => card.code === ownHighAttackCode);
    const ownDefense = session.state.cards.find((card) => card.code === ownDefenseCode);
    const opponentLowAttack = session.state.cards.find((card) => card.code === opponentLowAttackCode);
    const opponentDefense = session.state.cards.find((card) => card.code === opponentDefenseCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(hammerShot).toBeDefined();
    expect(ownHighAttack).toBeDefined();
    expect(ownDefense).toBeDefined();
    expect(opponentLowAttack).toBeDefined();
    expect(opponentDefense).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, hammerShot!.uid, "hand", 0);
    moveDuelCard(session.state, ownHighAttack!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ownDefense!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, opponentLowAttack!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentDefense!.uid, "monsterZone", 1).position = "faceUpDefense";
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
    expect(host.loadCardScript(Number(hammerShotCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const hammerShotAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === hammerShot!.uid);
    expect(hammerShotAction).toBeDefined();
    applyAndAssert(session, hammerShotAction!);
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
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-26412048-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-26412047-0",
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [ownHighAttack!.uid], count: 1, player: 0, parameter: 0 },
    ]);

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
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-26412048-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-26412047-0",
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [ownHighAttack!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === hammerShot!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownHighAttack!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownDefense!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentLowAttack!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDefense!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownHighAttack!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: hammerShot!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("hammer shot responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("hammer shot responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
}
