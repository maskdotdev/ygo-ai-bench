import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, ritualSummonDuelCard, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
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
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shinobaroness Peacock shuffle and summon", () => {
  it("restores its Ritual-summoned Spell/Trap shuffle trigger and optional Deck Spirit Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const peacockCode = "25415052";
    const materialCode = "25415053";
    const deckSpiritCode = "25415054";
    const opponentSpellCode = "25415055";
    const opponentTrapCode = "25415056";
    const opponentMonsterCode = "25415057";
    const responderCode = "25415058";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === peacockCode),
      { code: materialCode, name: "Shinobaroness Peacock Ritual Material", kind: "monster", typeFlags: typeMonster, level: 8, attack: 1000, defense: 1000 },
      { code: deckSpiritCode, name: "Shinobaroness Peacock Deck Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1000, defense: 1000 },
      { code: opponentSpellCode, name: "Shinobaroness Peacock Opponent Spell", kind: "spell", typeFlags: typeSpell },
      { code: opponentTrapCode, name: "Shinobaroness Peacock Opponent Trap", kind: "trap", typeFlags: typeTrap },
      { code: opponentMonsterCode, name: "Shinobaroness Peacock Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Shinobaroness Peacock Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2541, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [peacockCode, materialCode, deckSpiritCode] }, 1: { main: [opponentSpellCode, opponentTrapCode, opponentMonsterCode, responderCode] } });
    startDuel(session);

    const peacock = requireCard(session, peacockCode);
    const material = requireCard(session, materialCode);
    const deckSpirit = requireCard(session, deckSpiritCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const responder = requireCard(session, responderCode);
    peacock.data.ritualMaterials = [materialCode];
    moveDuelCard(session.state, peacock.uid, "hand", 0);
    moveDuelCard(session.state, material.uid, "hand", 0);
    moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1);
    moveDuelCard(session.state, opponentTrap.uid, "spellTrapZone", 1);
    moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    opponentSpell.faceUp = false;
    opponentTrap.faceUp = false;
    opponentMonster.faceUp = true;
    opponentMonster.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(peacockCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    ritualSummonDuelCard(session.state, 0, peacock.uid, [material.uid]);
    expect(session.state.cards.find((card) => card.uid === peacock.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "ritual",
    });
    expect(session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0 });

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1102",
          "eventCardUid": "p0-deck-25415052-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-25415052-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === peacock.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-7-1102",
          "eventCardUid": "p0-deck-25415052-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "chain-6",
          "operationInfos": [
            {
              "category": 16,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [],
            },
          ],
          "player": 0,
          "possibleOperationInfos": [
            {
              "category": 512,
              "count": 1,
              "parameter": 1,
              "player": 0,
              "targetUids": [],
            },
          ],
          "sourceUid": "p0-deck-25415052-0",
        },
      ]
    `);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, pass!);
    expect(restoredChain.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
    ]));
    expect(restoredChain.host.messages).not.toContain("shinobaroness peacock responder resolved");

    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentTrap.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === deckSpirit.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToDeck", "specialSummoned"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-25415052-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-25415055-0",
          "eventCode": 1013,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToDeck",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": false,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-25415052-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-25415056-1",
          "eventCode": 1013,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventName": "sentToDeck",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": false,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-25415052-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-25415055-0",
          "eventCode": 1013,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToDeck",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": false,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-25415052-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p1-deck-25415055-0",
            "p1-deck-25415056-1",
          ],
        },
        {
          "eventCardUid": "p0-deck-25415054-2",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 2064,
          "eventReasonCardUid": "p0-deck-25415052-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-25415054-2",
          ],
        },
      ]
    `);
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
      e:SetOperation(function(e,tp) Debug.Message("shinobaroness peacock responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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
