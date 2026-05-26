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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wizard Buster self equip", () => {
  it("restores Wizard Buster's Buster Blader target and self-equip operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wizardCode = "2602411";
    const busterBladerCode = "78193831";
    const offTargetCode = "2602412";
    const responderCode = "2602413";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wizardCode),
      { code: busterBladerCode, name: "Wizard Buster Buster Blader Target", kind: "monster", typeFlags: 0x1, level: 7, attack: 2600, defense: 2300 },
      { code: offTargetCode, name: "Wizard Buster Off-Target Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
      { code: responderCode, name: "Wizard Buster Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 260, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wizardCode, busterBladerCode, offTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const wizard = session.state.cards.find((card) => card.code === wizardCode);
    const busterBlader = session.state.cards.find((card) => card.code === busterBladerCode);
    const offTarget = session.state.cards.find((card) => card.code === offTargetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(wizard).toBeDefined();
    expect(busterBlader).toBeDefined();
    expect(offTarget).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, wizard!.uid, "hand", 0);
    moveDuelCard(session.state, busterBlader!.uid, "monsterZone", 0);
    busterBlader!.position = "faceUpAttack";
    busterBlader!.faceUp = true;
    moveDuelCard(session.state, offTarget!.uid, "monsterZone", 0);
    offTarget!.position = "faceUpAttack";
    offTarget!.faceUp = true;
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
    expect(host.loadCardScript(Number(wizardCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const wizardAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === wizard!.uid);
    expect(wizardAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, wizardAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-2602411-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-2602411-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-78193831-1",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x40000, targetUids: [wizard!.uid], count: 1, player: 0, parameter: 0 },
    ]);
    expect(session.state.chain[0]?.targetUids).toEqual([busterBlader!.uid]);
    expect(session.state.chain[0]?.targetUids).not.toContain(offTarget!.uid);

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
        "effectId": "lua-1",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-2602411-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-2602411-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-78193831-1",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x40000, targetUids: [wizard!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === wizard!.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: busterBlader!.uid,
      faceUp: true,
    });
    expect(restored.session.state.cards.find((card) => card.uid === busterBlader!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    const restoredOffTarget = restored.session.state.cards.find((card) => card.uid === offTarget!.uid);
    expect(restoredOffTarget).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOffTarget?.equippedToUid).toBeUndefined();
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "equipped" && event.eventCardUid === wizard!.uid)).toEqual([
      {
        eventName: "equipped",
        eventCode: 1121,
        eventCardUid: wizard!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wizard!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "spellTrapZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      },
    ]);
    expect(restored.host.messages).not.toContain("wizard buster responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("wizard buster responder resolved") end)
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
}
