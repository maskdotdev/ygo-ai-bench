import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Yaksha Spirit backrow return", () => {
  it("restores its summon trigger and returns one opponent Spell/Trap to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yakshaCode = "94215860";
    const targetBackrowCode = "94215861";
    const sideBackrowCode = "94215862";
    const monsterCode = "94215863";
    const responderCode = "94215864";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yakshaCode),
      { code: targetBackrowCode, name: "Yaksha Target Backrow", kind: "spell", typeFlags: typeSpell },
      { code: sideBackrowCode, name: "Yaksha Side Backrow", kind: "trap", typeFlags: typeTrap },
      { code: monsterCode, name: "Yaksha Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: responderCode, name: "Yaksha Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 942, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yakshaCode] }, 1: { main: [targetBackrowCode, sideBackrowCode, monsterCode, responderCode] } });
    startDuel(session);

    const yaksha = session.state.cards.find((card) => card.code === yakshaCode);
    const targetBackrow = session.state.cards.find((card) => card.code === targetBackrowCode);
    const sideBackrow = session.state.cards.find((card) => card.code === sideBackrowCode);
    const monster = session.state.cards.find((card) => card.code === monsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(yaksha).toBeDefined();
    expect(targetBackrow).toBeDefined();
    expect(sideBackrow).toBeDefined();
    expect(monster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, yaksha!.uid, "hand", 0);
    moveDuelCard(session.state, targetBackrow!.uid, "spellTrapZone", 1);
    targetBackrow!.sequence = 0;
    targetBackrow!.position = "faceDown";
    targetBackrow!.faceUp = false;
    moveDuelCard(session.state, sideBackrow!.uid, "spellTrapZone", 1);
    sideBackrow!.sequence = 1;
    sideBackrow!.position = "faceDown";
    sideBackrow!.faceUp = false;
    moveDuelCard(session.state, monster!.uid, "monsterZone", 1);
    monster!.position = "faceUpAttack";
    monster!.faceUp = true;
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
    expect(host.loadCardScript(Number(yakshaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === yaksha!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === yaksha!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-7-1100",
          "eventCardUid": "p0-deck-94215860-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "normalSummoned",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "chain-4",
          "operationInfos": [
            {
              "category": 8,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p1-deck-94215861-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-94215860-0",
          "targetFieldIds": [
            7,
          ],
          "targetUids": [
            "p1-deck-94215861-0",
          ],
        },
      ]
    `);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === yaksha!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === targetBackrow!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === sideBackrow!.uid)).toMatchObject({ location: "spellTrapZone", controller: 1, sequence: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === targetBackrow!.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: targetBackrow!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: yaksha!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
      },
    ]);
    expect(restoredChainWindow.host.messages).not.toContain("yaksha responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("yaksha responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
