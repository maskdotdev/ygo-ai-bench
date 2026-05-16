import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Equip procedure actions", () => {
    it("restores Battle Archfiend Shield equip procedure setcode target filtering", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const shieldCode = "8730435";
      const gladiatorCode = "601009";
      const offSetCode = "601010";
      const responderCode = "601011";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shieldCode),
        { code: gladiatorCode, name: "Shield Gladiator Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1600, defense: 1200, setcodes: [0x19] },
        { code: offSetCode, name: "Shield Off-Set Decoy", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1700, defense: 1000, setcodes: [0x123] },
        { code: responderCode, name: "Shield Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [shieldCode, gladiatorCode, offSetCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const shield = session.state.cards.find((card) => card.code === shieldCode);
      const gladiator = session.state.cards.find((card) => card.code === gladiatorCode);
      const offSet = session.state.cards.find((card) => card.code === offSetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(shield).toBeDefined();
      expect(gladiator).toBeDefined();
      expect(offSet).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, shield!.uid, "hand", 0);
      moveDuelCard(session.state, gladiator!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, offSet!.uid, "monsterZone", 0).position = "faceUpAttack";
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
      expect(host.loadCardScript(Number(shieldCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
      expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === shield!.uid);
      expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

      expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
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
                "p0-deck-8730435-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-8730435-0",
          "targetUids": [
            "p0-deck-601009-1",
          ],
        }
      `);
      expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(offSet!.uid);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(restoredChain.session.state.chain[0]).toEqual(restoredEquipWindow.session.state.chain[0]!);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === shield!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: gladiator!.uid,
        faceUp: true,
      });
      const restoredOffSet = restoredChain.session.state.cards.find((card) => card.uid === offSet!.uid);
      expect(restoredOffSet).toMatchObject({ location: "monsterZone" });
      expect(restoredOffSet?.equippedToUid).toBeUndefined();
    });

    it("restores Hercules Base equip procedure condition and battle locks", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const baseCode = "97616504";
      const blockerCode = "601012";
      const opponentTargetCode = "601013";
      const responderCode = "601014";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === baseCode),
        { code: blockerCode, name: "Hercules Base Main Zone Blocker", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: opponentTargetCode, name: "Hercules Base Opponent Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
        { code: responderCode, name: "Hercules Base Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 302, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [baseCode, blockerCode] }, 1: { main: [opponentTargetCode, responderCode] } });
      startDuel(session);

      const base = session.state.cards.find((card) => card.code === baseCode);
      const blocker = session.state.cards.find((card) => card.code === blockerCode);
      const opponentTarget = session.state.cards.find((card) => card.code === opponentTargetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(base).toBeDefined();
      expect(blocker).toBeDefined();
      expect(opponentTarget).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, base!.uid, "hand", 0);
      moveDuelCard(session.state, blocker!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, opponentTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
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
      expect(host.loadCardScript(Number(baseCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredBlocked = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredBlocked);
      expectRestoredLegalActions(restoredBlocked, restoredBlocked.session.state.waitingFor ?? restoredBlocked.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredBlocked, 0).some((action) => action.type === "activateEffect" && action.uid === base!.uid)).toBe(false);

      moveDuelCard(restoredBlocked.session.state, blocker!.uid, "graveyard", 0);
      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBlocked.session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
      expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === base!.uid);
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
                "p0-deck-97616504-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-97616504-0",
          "targetUids": [
            "p1-deck-601013-0",
          ],
        }
      `);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(restoredChain.session.state.chain[0]).toEqual(restoredEquipWindow.session.state.chain[0]!);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === base!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: opponentTarget!.uid,
        faceUp: true,
      });

      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      expect(restoredEquipState.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === base!.uid && [73, 346].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
        [
          {
            "canActivate": [Function],
            "code": 73,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-3-73",
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:97616504:lua-3-73",
            "sourceUid": "p0-deck-97616504-0",
            "target": [Function],
          },
          {
            "canActivate": [Function],
            "code": 346,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-4-346",
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:97616504:lua-4-346",
            "sourceUid": "p0-deck-97616504-0",
            "target": [Function],
            "value": 1,
          },
        ]
      `);
      restoredEquipState.session.state.turnPlayer = 1;
      restoredEquipState.session.state.phase = "battle";
      restoredEquipState.session.state.waitingFor = 1;
      const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
      expectCleanRestore(restoredBattle);
      expectRestoredLegalActions(restoredBattle, restoredBattle.session.state.waitingFor ?? restoredBattle.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredBattle, 1).some((action) => action.type === "declareAttack" && action.attackerUid === opponentTarget!.uid)).toBe(false);
    });

    it("restores Hercules Base battle-destroying draw trigger", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const baseCode = "97616504";
      const equippedAttackerCode = "601015";
      const battleTargetCode = "601016";
      const graveSpellCodes = ["601017", "601018", "601019"];
      const drawCardCode = "601020";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === baseCode),
        { code: equippedAttackerCode, name: "Hercules Base Equipped Attacker", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
        { code: battleTargetCode, name: "Hercules Base Battle Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        ...graveSpellCodes.map((code) => ({ code, name: `Hercules Base Grave Spell ${code}`, kind: "spell" as const, typeFlags: 0x2 })),
        { code: drawCardCode, name: "Hercules Base Draw Card", kind: "spell" as const, typeFlags: 0x2 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [baseCode, battleTargetCode, ...graveSpellCodes, drawCardCode] }, 1: { main: [equippedAttackerCode] } });
      startDuel(session);

      const base = session.state.cards.find((card) => card.code === baseCode);
      const equippedAttacker = session.state.cards.find((card) => card.code === equippedAttackerCode);
      const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
      const drawCard = session.state.cards.find((card) => card.code === drawCardCode);
      expect(base).toBeDefined();
      expect(equippedAttacker).toBeDefined();
      expect(battleTarget).toBeDefined();
      expect(drawCard).toBeDefined();
      moveDuelCard(session.state, base!.uid, "spellTrapZone", 0).faceUp = true;
      base!.equippedToUid = equippedAttacker!.uid;
      moveDuelCard(session.state, equippedAttacker!.uid, "monsterZone", 1).position = "faceUpAttack";
      moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 0).position = "faceUpAttack";
      for (const code of graveSpellCodes) {
        const spell = session.state.cards.find((card) => card.code === code);
        expect(spell).toBeDefined();
        moveDuelCard(session.state, spell!.uid, "graveyard", 0);
      }
      session.state.turnPlayer = 1;
      session.state.phase = "battle";
      session.state.waitingFor = 1;

      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(baseCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);

      const restoredBattleWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expectCleanRestore(restoredBattleWindow);
      expectRestoredLegalActions(restoredBattleWindow, restoredBattleWindow.session.state.waitingFor ?? restoredBattleWindow.session.state.turnPlayer);
      const attack = getLuaRestoreLegalActions(restoredBattleWindow, 1).find(
        (action) => action.type === "declareAttack" && action.attackerUid === equippedAttacker!.uid && action.targetUid === battleTarget!.uid,
      );
      expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleWindow, 1), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredBattleWindow, attack!);
      passRestoredBattleResponsesUntilTrigger(restoredBattleWindow);

      expect(restoredBattleWindow.session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredBattleWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
        [
          {
            "effectId": "lua-5-1139",
            "eventCardUid": "p1-deck-601015-0",
            "eventCode": 1140,
            "eventCurrentState": {
              "controller": 1,
              "faceUp": true,
              "location": "monsterZone",
              "position": "faceUpAttack",
              "sequence": 0,
            },
            "eventName": "battleDestroyed",
            "eventPlayer": 0,
            "eventPreviousState": {
              "controller": 1,
              "faceUp": false,
              "location": "deck",
              "position": "faceDown",
              "sequence": 0,
            },
            "eventReason": 33,
            "eventReasonCardUid": "p1-deck-601015-0",
            "eventReasonPlayer": 1,
            "eventTriggerTiming": "when",
            "id": "trigger-6-1",
            "player": 0,
            "sourceUid": "p0-deck-97616504-0",
            "triggerBucket": "opponentMandatory",
          },
        ]
      `);

      const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleWindow.session), workspace, reader);
      expectCleanRestore(restoredTriggerWindow);
      expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
      const drawTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === base!.uid);
      expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredTriggerWindow, drawTrigger!);
      expect(restoredTriggerWindow.session.state.chain).toEqual([]);
      expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([]);
      expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === drawCard!.uid)).toMatchObject({ location: "hand", controller: 0 });
      expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
        {
          eventName: "battleDestroyed",
          eventCode: 1140,
          eventCardUid: battleTarget!.uid,
          eventReason: duelReason.battle | duelReason.destroy,
          eventReasonPlayer: 1,
          eventReasonCardUid: equippedAttacker!.uid,
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
            sequence: 3,
          },
        },
      ]);
      expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
        {
          eventName: "cardsDrawn",
          eventCode: 1110,
          eventCardUid: drawCard!.uid,
          eventPlayer: 0,
          eventValue: 1,
          eventUids: [drawCard!.uid],
          eventReason: duelReason.effect,
          eventReasonPlayer: 0,
          eventReasonCardUid: base!.uid,
          eventReasonEffectId: 5,
          eventPreviousState: {
            controller: 0,
            faceUp: false,
            location: "deck",
            position: "faceDown",
            sequence: 4,
          },
          eventCurrentState: {
            controller: 0,
            faceUp: false,
            location: "hand",
            position: "faceDown",
            sequence: 0,
          },
        },
      ]);
    });

    it("restores Hercules Base graveyard trigger target and to-Deck operation", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const baseCode = "97616504";
      const skyStrikerCode = "601015";
      const offSetCode = "601016";
      const responderCode = "601017";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === baseCode),
        { code: skyStrikerCode, name: "Hercules Base Sky Striker Target", kind: "spell" as const, typeFlags: 0x2, setcodes: [0x115] },
        { code: offSetCode, name: "Hercules Base Off-Set Graveyard Card", kind: "spell" as const, typeFlags: 0x2, setcodes: [0x123] },
        { code: responderCode, name: "Hercules Base Grave Trigger Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 303, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [baseCode, skyStrikerCode, offSetCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const base = session.state.cards.find((card) => card.code === baseCode);
      const skyStriker = session.state.cards.find((card) => card.code === skyStrikerCode);
      const offSet = session.state.cards.find((card) => card.code === offSetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(base).toBeDefined();
      expect(skyStriker).toBeDefined();
      expect(offSet).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, base!.uid, "spellTrapZone", 0).faceUp = true;
      moveDuelCard(session.state, skyStriker!.uid, "graveyard", 0);
      moveDuelCard(session.state, offSet!.uid, "graveyard", 0);
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
      expect(host.loadCardScript(Number(baseCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      destroyDuelCard(session.state, base!.uid, 0, duelReason.effect | duelReason.destroy, 0);
      expect(session.state.cards.find((card) => card.uid === base!.uid)).toMatchObject({
        location: "graveyard",
        previousLocation: "spellTrapZone",
        reason: duelReason.effect | duelReason.destroy,
      });
      expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
        [
          {
            "effectId": "lua-6-1014",
            "eventCardUid": "p0-deck-97616504-0",
            "eventCode": 1014,
            "eventCurrentState": {
              "controller": 0,
              "faceUp": true,
              "location": "graveyard",
              "position": "faceDown",
              "sequence": 2,
            },
            "eventName": "sentToGraveyard",
            "eventPreviousState": {
              "controller": 0,
              "faceUp": true,
              "location": "spellTrapZone",
              "position": "faceDown",
              "sequence": 0,
            },
            "eventReason": 65,
            "eventReasonPlayer": 0,
            "eventTriggerTiming": "if",
            "id": "trigger-3-1",
            "player": 0,
            "sourceUid": "p0-deck-97616504-0",
            "triggerBucket": "turnOptional",
          },
        ]
      `);

      const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredTriggerWindow);
      expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
      expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
      const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find(
        (action) => action.type === "activateTrigger" && action.uid === base!.uid,
      );
      expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

      expect(restoredTriggerWindow.session.state.chain[0]).toMatchInlineSnapshot(`
        {
          "activationLocation": "graveyard",
          "activationSequence": 2,
          "chainIndex": 1,
          "effectId": "lua-6-1014",
          "eventCardUid": "p0-deck-97616504-0",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 2,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "chain-3",
          "operationInfos": [
            {
              "category": 16,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p0-deck-601015-1",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-97616504-0",
          "targetUids": [
            "p0-deck-601015-1",
          ],
        }
      `);
      expect(restoredTriggerWindow.session.state.chain[0]?.targetUids).not.toContain(offSet!.uid);

      expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(restoredChain.session.state.chain[0]).toEqual(restoredTriggerWindow.session.state.chain[0]!);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.session.state.cards.find((card) => card.uid === skyStriker!.uid)).toMatchObject({ location: "deck", controller: 0 });
      expect(restoredChain.session.state.cards.find((card) => card.uid === offSet!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
      expect(restoredChain.session.state.cards.find((card) => card.uid === base!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck" && event.eventCardUid === skyStriker!.uid)).toEqual([
        {
          eventName: "sentToDeck",
          eventCode: 1013,
          eventCardUid: skyStriker!.uid,
          eventPreviousState: {
            location: "graveyard",
            controller: 0,
            sequence: 0,
            position: "faceDown",
            faceUp: true,
          },
          eventCurrentState: {
            location: "deck",
            controller: 0,
            sequence: 0,
            position: "faceDown",
            faceUp: true,
          },
          eventReason: duelReason.effect,
          eventReasonPlayer: 0,
          eventReasonCardUid: base!.uid,
          eventReasonEffectId: 6,
        },
      ]);
    });

    it("restores Shooting Star Bow equip attack loss and direct attack permission", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const bowCode = "95638658";
      const targetCode = "601041";
      const battleTargetCode = "601042";
      const responderCode = "601043";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bowCode),
        { code: targetCode, name: "Shooting Star Bow Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
        { code: battleTargetCode, name: "Shooting Star Bow Battle Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: responderCode, name: "Shooting Star Bow Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 318, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [bowCode, targetCode] }, 1: { main: [battleTargetCode, responderCode] } });
      startDuel(session);

      const bow = session.state.cards.find((card) => card.code === bowCode);
      const target = session.state.cards.find((card) => card.code === targetCode);
      const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(bow).toBeDefined();
      expect(target).toBeDefined();
      expect(battleTarget).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, bow!.uid, "hand", 0);
      moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
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
      expect(host.loadCardScript(Number(bowCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === bow!.uid);
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
                "p0-deck-95638658-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-95638658-0",
          "targetUids": [
            "p0-deck-601041-1",
          ],
        }
      `);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === bow!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: target!.uid,
        faceUp: true,
      });

      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      expect(restoredEquipState.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === bow!.uid && [74, 100].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
        [
          {
            "canActivate": [Function],
            "code": 100,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-3-100",
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:95638658:lua-3-100",
            "sourceUid": "p0-deck-95638658-0",
            "target": [Function],
            "value": -1000,
          },
          {
            "canActivate": [Function],
            "code": 74,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-4-74",
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:95638658:lua-4-74",
            "sourceUid": "p0-deck-95638658-0",
            "target": [Function],
          },
        ]
      `);
      expectLuaEquipProbe(restoredEquipState, targetCode, bowCode, "equip probe 95638658/800");

      restoredEquipState.session.state.turnPlayer = 0;
      restoredEquipState.session.state.phase = "battle";
      restoredEquipState.session.state.waitingFor = 0;
      const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
      expectCleanRestore(restoredBattle);
      expectRestoredLegalActions(restoredBattle, restoredBattle.session.state.waitingFor ?? restoredBattle.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredBattle, 0).some((action) => action.type === "declareAttack" && action.attackerUid === target!.uid && action.targetUid === battleTarget!.uid)).toBe(true);
      const directAttack = getLuaRestoreLegalActions(restoredBattle, 0).find(
        (action) => action.type === "declareAttack" && action.attackerUid === target!.uid && action.directAttack === true,
      );
      expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredBattle, directAttack!);
      passRestoredBattleResponsesUntilTrigger(restoredBattle);

      expect(restoredBattle.session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
      expect(restoredBattle.session.state.players[1].lifePoints).toBe(7200);
    });

    it("restores Cestus of Dagla equip Fairy filtering, attack boost, and battle-damage recovery", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const cestusCode = "28106077";
      const fairyCode = "601044";
      const warriorCode = "601045";
      const battleTargetCode = "601046";
      const responderCode = "601047";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cestusCode),
        { code: fairyCode, name: "Cestus Fairy Target", kind: "monster" as const, typeFlags: 0x1, race: 0x4, level: 4, attack: 1500, defense: 1200 },
        { code: warriorCode, name: "Cestus Warrior Decoy", kind: "monster" as const, typeFlags: 0x1, race: 0x1, level: 4, attack: 1600, defense: 1000 },
        { code: battleTargetCode, name: "Cestus Battle Target", kind: "monster" as const, typeFlags: 0x1, race: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: responderCode, name: "Cestus Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 309, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [cestusCode, fairyCode, warriorCode] }, 1: { main: [battleTargetCode, responderCode] } });
      startDuel(session);

      const cestus = session.state.cards.find((card) => card.code === cestusCode);
      const fairy = session.state.cards.find((card) => card.code === fairyCode);
      const warrior = session.state.cards.find((card) => card.code === warriorCode);
      const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(cestus).toBeDefined();
      expect(fairy).toBeDefined();
      expect(warrior).toBeDefined();
      expect(battleTarget).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, cestus!.uid, "hand", 0);
      moveDuelCard(session.state, fairy!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, warrior!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
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
      expect(host.loadCardScript(Number(cestusCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === cestus!.uid);
      expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

      expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
      const equipChain = restoredEquipWindow.session.state.chain[0]!;
      expect(equipChain.activationLocation).toBe("hand");
      expect(equipChain.sourceUid).toBe(cestus!.uid);
      expect(equipChain.targetUids).toEqual([fairy!.uid]);
      expect(equipChain.operationInfos).toEqual([{ category: 0x40000, targetUids: [cestus!.uid], count: 1, player: 0, parameter: 0 }]);
      expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(warrior!.uid);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === cestus!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: fairy!.uid,
        faceUp: true,
      });
      const restoredWarrior = restoredChain.session.state.cards.find((card) => card.uid === warrior!.uid);
      expect(restoredWarrior).toMatchObject({ location: "monsterZone" });
      expect(restoredWarrior?.equippedToUid).toBeUndefined();

      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      const restoredCestusTrigger = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === cestus!.uid && effect.code === 1143);
      expect(restoredCestusTrigger?.event).toBe("trigger");
      expect(restoredCestusTrigger?.range).toEqual(["spellTrapZone"]);
      const restoredCestusAttack = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === cestus!.uid && effect.code === 100);
      expect(restoredCestusAttack?.event).toBe("continuous");
      expect(restoredCestusAttack?.range).toEqual(["spellTrapZone"]);
      expect(restoredCestusAttack?.value).toBe(500);
      expectLuaEquipProbe(restoredEquipState, fairyCode, cestusCode, "equip probe 28106077/2000");

      restoredEquipState.session.state.turnPlayer = 0;
      restoredEquipState.session.state.phase = "battle";
      restoredEquipState.session.state.waitingFor = 0;
      const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
      expectCleanRestore(restoredBattle);
      expectRestoredLegalActions(restoredBattle, restoredBattle.session.state.waitingFor ?? restoredBattle.session.state.turnPlayer);
      const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
        (action) => action.type === "declareAttack" && action.attackerUid === fairy!.uid && action.targetUid === battleTarget!.uid,
      );
      expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredBattle, attack!);
      passRestoredBattleResponsesUntilTrigger(restoredBattle);

      expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000);
      expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
      const pendingTrigger = restoredBattle.session.state.pendingTriggers[0]!;
      expect(restoredBattle.session.state.pendingTriggers).toEqual([
        {
          effectId: pendingTrigger.effectId,
          eventName: "battleDamageDealt",
          eventCode: 1143,
          eventCardUid: fairy!.uid,
          eventCurrentState: {
            controller: 0,
            faceUp: true,
            location: "monsterZone",
            position: "faceUpAttack",
            sequence: 0,
          },
          eventPlayer: 1,
          eventPreviousState: {
            controller: 0,
            faceUp: false,
            location: "deck",
            position: "faceDown",
            sequence: 2,
          },
          eventReason: duelReason.battle,
          eventReasonPlayer: 0,
          eventTriggerTiming: "when",
          eventValue: 1000,
          id: pendingTrigger.id,
          player: 0,
          sourceUid: cestus!.uid,
          triggerBucket: "turnMandatory",
        },
      ]);

      const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
      expectCleanRestore(restoredTrigger);
      expectRestoredLegalActions(restoredTrigger, 0);
      const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cestus!.uid);
      expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredTrigger, trigger!);
      expect(restoredTrigger.session.state.chain).toHaveLength(1);
      const recoveryChain = restoredTrigger.session.state.chain[0]!;
      expect(recoveryChain.activationLocation).toBe("spellTrapZone");
      expect(recoveryChain.sourceUid).toBe(cestus!.uid);
      expect(recoveryChain.targetParam).toBe(1000);
      expect(recoveryChain.targetPlayer).toBe(0);
      expect(recoveryChain.operationInfos).toEqual([{ category: 0x100000, targetUids: [], count: 0, player: 0, parameter: 1000 }]);

      const restoredRecoveryChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
      expectCleanRestore(restoredRecoveryChain);
      expectRestoredLegalActions(restoredRecoveryChain, 1);
      resolveRestoredChain(restoredRecoveryChain);

      expect(restoredRecoveryChain.session.state.players[0].lifePoints).toBe(9000);
      expect(restoredRecoveryChain.session.state.players[1].lifePoints).toBe(7000);
      expect(restoredRecoveryChain.session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
      expect(restoredRecoveryChain.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints" && event.eventPlayer === 0)).toEqual([
        {
          eventName: "recoveredLifePoints",
          eventCode: 1112,
          eventPlayer: 0,
          eventValue: 1000,
          eventReason: duelReason.effect,
          eventReasonPlayer: 0,
          eventReasonCardUid: cestus!.uid,
          eventReasonEffectId: 3,
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
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)
      e:SetHintTiming(TIMING_BATTLE_PHASE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("equip responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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

function passRestoredBattleResponsesUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
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
    "axe-of-despair-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function expectLuaEquipStatProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("equip stat probe " .. equip:GetCode() .. "/" .. target:GetAttack() .. "/" .. target:GetDefense())
    `,
    "equip-stat-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
