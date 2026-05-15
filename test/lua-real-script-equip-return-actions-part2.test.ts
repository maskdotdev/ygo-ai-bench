import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import {
  createDuel,
  destroyDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Equip return actions", () => {
    it("restores Smoke Grenade of the Thief destroyed equip hand discard trigger", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const smokeCode = "63789924";
      const targetCode = "601043";
      const discardACode = "601044";
      const discardBCode = "601045";
      const responderCode = "601046";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === smokeCode),
        { code: targetCode, name: "Smoke Grenade Equip Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: discardACode, name: "Smoke Grenade Discard A", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: discardBCode, name: "Smoke Grenade Discard B", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: responderCode, name: "Smoke Grenade Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 314, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [smokeCode, targetCode] }, 1: { main: [discardACode, discardBCode, responderCode] } });
      startDuel(session);

      const smoke = session.state.cards.find((card) => card.code === smokeCode);
      const target = session.state.cards.find((card) => card.code === targetCode);
      const discardA = session.state.cards.find((card) => card.code === discardACode);
      const discardB = session.state.cards.find((card) => card.code === discardBCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(smoke).toBeDefined();
      expect(target).toBeDefined();
      expect(discardA).toBeDefined();
      expect(discardB).toBeDefined();
      expect(responder).toBeDefined();
      const confirmedOpponentHandUids = [discardA!.uid, discardB!.uid, responder!.uid];
      moveDuelCard(session.state, smoke!.uid, "hand", 0);
      moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, discardA!.uid, "hand", 1);
      moveDuelCard(session.state, discardB!.uid, "hand", 1);
      moveDuelCard(session.state, responder!.uid, "hand", 1);
      session.state.phase = "main1";
      session.state.waitingFor = 0;

      const source = {
        readScript(name: string) {
          if (name === `c${responderCode}.lua`) return chainResponderScript();
          return workspace.readScript(name);
        },
      };
      const host = createLuaScriptHost(session, source);
      expect(host.loadCardScript(Number(smokeCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
      expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === smoke!.uid);
      expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

      expect(restoredEquipWindow.session.state.chain[0]).toMatchInlineSnapshot(`
        {
          "activationLocation": "hand",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-1-1002",
          "id": "chain-2",
          "operationInfos": [
            {
              "category": 262144,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p0-deck-63789924-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-63789924-0",
          "targetUids": [
            "p0-deck-601043-1",
          ],
        }
      `);
      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === smoke!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: target!.uid,
        faceUp: true,
      });

      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      expectLuaEquipProbe(restoredEquipState, targetCode, smokeCode, "equip probe 63789924/1000");

      destroyDuelCard(restoredEquipState.session.state, smoke!.uid, 0, duelReason.effect | duelReason.destroy, 0);
      expect(restoredEquipState.session.state.cards.find((card) => card.uid === smoke!.uid)).toMatchObject({
        location: "graveyard",
        previousLocation: "spellTrapZone",
        previousEquippedToUid: target!.uid,
      });
      expect(restoredEquipState.session.state.pendingTriggers).toMatchInlineSnapshot(`
        [
          {
            "effectId": "lua-3-1015",
            "eventCardUid": "p0-deck-63789924-0",
            "eventCode": 1015,
            "eventCurrentState": {
              "controller": 0,
              "faceUp": true,
              "location": "graveyard",
              "position": "faceUpAttack",
              "sequence": 0,
            },
            "eventName": "leftField",
            "eventPreviousState": {
              "controller": 0,
              "faceUp": true,
              "location": "spellTrapZone",
              "position": "faceUpAttack",
              "sequence": 0,
            },
            "eventReason": 65,
            "eventReasonCardUid": "p0-deck-63789924-0",
            "eventReasonEffectId": 1,
            "eventReasonPlayer": 0,
            "eventTriggerTiming": "when",
            "id": "trigger-6-1",
            "player": 0,
            "sourceUid": "p0-deck-63789924-0",
            "triggerBucket": "turnMandatory",
          },
        ]
      `);

      const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
      expectCleanRestore(restoredTriggerWindow);
      expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
      const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === smoke!.uid);
      expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

      expect(restoredTriggerWindow.session.state.chain[0]).toMatchInlineSnapshot(`
        {
          "activationLocation": "graveyard",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-3-1015",
          "eventCardUid": "p0-deck-63789924-0",
          "eventCode": 1015,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "leftField",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "spellTrapZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-63789924-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "chain-6",
          "operationInfos": [
            {
              "category": 128,
              "count": 0,
              "parameter": 1,
              "player": 1,
              "targetUids": [],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-63789924-0",
          "targetPlayer": 0,
        }
      `);
      expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

      const restoredDiscardChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
      expectCleanRestore(restoredDiscardChain);
      expectRestoredLegalActions(restoredDiscardChain, restoredDiscardChain.session.state.waitingFor ?? restoredDiscardChain.session.state.turnPlayer);
      expect(restoredDiscardChain.session.state.chain[0]).toEqual(restoredTriggerWindow.session.state.chain[0]!);
      resolveRestoredChain(restoredDiscardChain);

      const discardedCards = [discardA!, discardB!].filter(
        (card) => restoredDiscardChain.session.state.cards.find((stateCard) => stateCard.uid === card.uid)?.location === "graveyard",
      );
      const remainingCards = [discardA!, discardB!].filter(
        (card) => restoredDiscardChain.session.state.cards.find((stateCard) => stateCard.uid === card.uid)?.location === "hand",
      );
      expect(discardedCards).toHaveLength(1);
      expect(remainingCards).toHaveLength(1);
      expect(restoredDiscardChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredDiscardChain.session.state.eventHistory.filter((event) => event.eventName === "confirmed" && event.eventPlayer === 0)).toEqual([
        {
          eventName: "confirmed",
          eventCode: 1211,
          eventPlayer: 0,
          eventCardUid: confirmedOpponentHandUids[0]!,
          eventValue: confirmedOpponentHandUids.length,
          eventUids: confirmedOpponentHandUids,
          eventReason: 0,
          eventReasonPlayer: 1,
          eventPreviousState: {
            controller: 1,
            faceUp: false,
            location: "deck",
            position: "faceDown",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 1,
            faceUp: false,
            location: "hand",
            position: "faceDown",
            sequence: 0,
          },
        },
      ]);
      expect(restoredDiscardChain.session.state.eventHistory.filter((event) => event.eventName === "discarded" && event.eventCardUid === discardedCards[0]!.uid)).toEqual([
        {
          eventName: "discarded",
          eventCode: 1018,
          eventCardUid: discardedCards[0]!.uid,
          eventReason: duelReason.effect | duelReason.discard,
          eventReasonPlayer: 0,
          eventReasonCardUid: smoke!.uid,
          eventReasonEffectId: 3,
          eventPreviousState: {
            controller: 1,
            faceUp: false,
            location: "hand",
            position: "faceDown",
            sequence: discardedCards[0]!.uid === discardA!.uid ? 0 : 1,
          },
          eventCurrentState: {
            controller: 1,
            faceUp: true,
            location: "graveyard",
            position: "faceDown",
            sequence: 0,
          },
        },
      ]);
      expect(restoredDiscardChain.session.state.eventHistory.filter((event) => event.eventName === "leftField" && event.eventCardUid === smoke!.uid)).toEqual([
        {
          eventName: "leftField",
          eventCode: 1015,
          eventCardUid: smoke!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 0,
          eventReasonCardUid: smoke!.uid,
          eventReasonEffectId: 1,
          eventPreviousState: {
            controller: 0,
            faceUp: true,
            location: "spellTrapZone",
            position: "faceUpAttack",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "graveyard",
            position: "faceUpAttack",
            sequence: 0,
          },
        },
      ]);
    });

    it("restores Blast with Chain remain-field Trap equip and destroyed trigger", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const blastCode = "98239899";
      const targetCode = "601047";
      const responderCode = "601048";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blastCode),
        { code: targetCode, name: "Blast with Chain Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: responderCode, name: "Blast with Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 315, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [blastCode, targetCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const blast = session.state.cards.find((card) => card.code === blastCode);
      const target = session.state.cards.find((card) => card.code === targetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(blast).toBeDefined();
      expect(target).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, blast!.uid, "spellTrapZone", 0).faceUp = false;
      moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, responder!.uid, "hand", 1);
      session.state.phase = "main1";
      session.state.waitingFor = 0;

      const source = {
        readScript(name: string) {
          if (name === `c${responderCode}.lua`) return chainResponderScript();
          return workspace.readScript(name);
        },
      };
      const host = createLuaScriptHost(session, source);
      expect(host.loadCardScript(Number(blastCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredActivation);
      expectRestoredLegalActions(restoredActivation, restoredActivation.session.state.waitingFor ?? restoredActivation.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredActivation, 0)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 0));
      expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
      const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === blast!.uid);
      expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredActivation, activate!);

      expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
        {
          "activationLocation": "spellTrapZone",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-1-1002",
          "id": "chain-2",
          "operationInfos": [
            {
              "category": 262144,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p0-deck-98239899-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-98239899-0",
          "targetUids": [
            "p0-deck-601047-1",
          ],
        }
      `);
      expect(restoredActivation.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 17 && effect.sourceUid === blast!.uid)).toMatchInlineSnapshot(`
        {
          "canActivate": [Function],
          "code": 17,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-17",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 524288,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:98239899:lua-4-17",
          "reset": {
            "flags": 2147483648,
          },
          "sourceUid": "p0-deck-98239899-0",
          "target": [Function],
        }
      `);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === blast!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: target!.uid,
        faceUp: true,
      });
      expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target!.uid), restoredChain.session.state)).toBe(1500);

      const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipped);
      expectRestoredLegalActions(restoredEquipped, restoredEquipped.session.state.waitingFor ?? restoredEquipped.session.state.turnPlayer);
      destroyDuelCard(restoredEquipped.session.state, blast!.uid, 0, duelReason.effect | duelReason.destroy, 0);
      expect(restoredEquipped.session.state.cards.find((card) => card.uid === blast!.uid)).toMatchObject({
        location: "graveyard",
        previousLocation: "spellTrapZone",
        previousEquippedToUid: target!.uid,
        reason: duelReason.effect | duelReason.destroy,
      });
      expect(currentAttack(restoredEquipped.session.state.cards.find((card) => card.uid === target!.uid), restoredEquipped.session.state)).toBe(1000);
      expect(restoredEquipped.session.state.pendingTriggers).toMatchInlineSnapshot(`
        [
          {
            "effectId": "lua-2-1015",
            "eventCardUid": "p0-deck-98239899-0",
            "eventCode": 1015,
            "eventCurrentState": {
              "controller": 0,
              "faceUp": true,
              "location": "graveyard",
              "position": "faceUpAttack",
              "sequence": 0,
            },
            "eventName": "leftField",
            "eventPreviousState": {
              "controller": 0,
              "faceUp": true,
              "location": "spellTrapZone",
              "position": "faceUpAttack",
              "sequence": 0,
            },
            "eventReason": 65,
            "eventReasonCardUid": "p0-deck-98239899-0",
            "eventReasonEffectId": 1,
            "eventReasonPlayer": 0,
            "eventTriggerTiming": "when",
            "id": "trigger-6-1",
            "player": 0,
            "sourceUid": "p0-deck-98239899-0",
            "triggerBucket": "turnMandatory",
          },
        ]
      `);

      const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
      expectCleanRestore(restoredTrigger);
      expectRestoredLegalActions(restoredTrigger, restoredTrigger.session.state.waitingFor ?? restoredTrigger.session.state.turnPlayer);
      const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === blast!.uid);
      expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredTrigger, trigger!);

      expect(restoredTrigger.session.state.chain[0]).toMatchInlineSnapshot(`
        {
          "activationLocation": "graveyard",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-2-1015",
          "eventCardUid": "p0-deck-98239899-0",
          "eventCode": 1015,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "leftField",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "spellTrapZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-98239899-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "chain-6",
          "operationInfos": [
            {
              "category": 1,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p0-deck-601047-1",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-98239899-0",
          "targetUids": [
            "p0-deck-601047-1",
          ],
        }
      `);
      expect(getLuaRestoreLegalActions(restoredTrigger, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

      const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
      expectCleanRestore(restoredDestroyChain);
      expectRestoredLegalActions(restoredDestroyChain, restoredDestroyChain.session.state.waitingFor ?? restoredDestroyChain.session.state.turnPlayer);
      expect(restoredDestroyChain.session.state.chain[0]).toEqual(restoredTrigger.session.state.chain[0]!);
      resolveRestoredChain(restoredDestroyChain);

      expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
        location: "graveyard",
        previousLocation: "monsterZone",
        reason: duelReason.effect | duelReason.destroy,
      });
      expect(restoredDestroyChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredDestroyChain.session.state.eventHistory.filter((event) => ["leftField", "destroyed"].includes(event.eventName))).toEqual([
        {
          eventName: "leftField",
          eventCode: 1015,
          eventCardUid: blast!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 0,
          eventReasonCardUid: blast!.uid,
          eventReasonEffectId: 1,
          eventPreviousState: {
            controller: 0,
            faceUp: true,
            location: "spellTrapZone",
            position: "faceUpAttack",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "graveyard",
            position: "faceUpAttack",
            sequence: 0,
          },
        },
        {
          eventName: "destroyed",
          eventCode: 1029,
          eventCardUid: blast!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 0,
          eventReasonCardUid: blast!.uid,
          eventReasonEffectId: 1,
          eventPreviousState: {
            controller: 0,
            faceUp: true,
            location: "spellTrapZone",
            position: "faceUpAttack",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "graveyard",
            position: "faceUpAttack",
            sequence: 0,
          },
        },
        {
          eventName: "leftField",
          eventCode: 1015,
          eventCardUid: target!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 0,
          eventReasonCardUid: blast!.uid,
          eventReasonEffectId: 2,
          eventPreviousState: {
            controller: 0,
            faceUp: true,
            location: "monsterZone",
            position: "faceUpAttack",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "graveyard",
            position: "faceUpAttack",
            sequence: 1,
          },
        },
        {
          eventName: "destroyed",
          eventCode: 1029,
          eventCardUid: target!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 0,
          eventReasonCardUid: blast!.uid,
          eventReasonEffectId: 2,
          eventPreviousState: {
            controller: 0,
            faceUp: true,
            location: "monsterZone",
            position: "faceUpAttack",
            sequence: 0,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "graveyard",
            position: "faceUpAttack",
            sequence: 1,
          },
        },
      ]);
    });
});

function chainResponderScript(): string {
  return `
  local s,id=GetID()
  function s.initial_effect(c)
    local e=Effect.CreateEffect(c)
    e:SetType(EFFECT_TYPE_QUICK_O)
    e:SetRange(LOCATION_HAND)
    e:SetCode(EVENT_CHAINING)
    e:SetCondition(function() return Duel.GetCurrentChain()>0 end)
    e:SetOperation(function() Debug.Message("equip responder resolved") end)
    c:RegisterEffect(e)
  end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelResponse): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("equip probe " .. equip:GetCode() .. "/" .. target:GetAttack())
    `,
    "equip-return-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
