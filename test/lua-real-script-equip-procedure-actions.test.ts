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
    it("restores Axe of Despair equip procedure target and stat effect", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const axeCode = "40619825";
      const targetCode = "601007";
      const responderCode = "601008";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === axeCode),
        { code: targetCode, name: "Equip Procedure Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: responderCode, name: "Equip Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 300, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [axeCode, targetCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const axe = session.state.cards.find((card) => card.code === axeCode);
      const target = session.state.cards.find((card) => card.code === targetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(axe).toBeDefined();
      expect(target).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, axe!.uid, "hand", 0);
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
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(axeCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredEquipWindow, 0));
      expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === axe!.uid);
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
                "p0-deck-40619825-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-40619825-0",
          "targetUids": [
            "p0-deck-601007-1",
          ],
        }
      `);
      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(restoredChain.session.state.chain[0]).toEqual(restoredEquipWindow.session.state.chain[0]!);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.session.state.cards.find((card) => card.uid === axe!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: target!.uid,
        faceUp: true,
      });
      expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
      expect(restoredChain.host.messages).not.toContain("equip responder resolved");

      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      expectLuaEquipProbe(restoredEquipState, targetCode, axeCode, "equip probe 40619825/2000");
    });

    it("restores Dragon Treasure race-filtered equip target and attack/defense boosts", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const dragonTreasureCode = "1435851";
      const dragonCode = "601050";
      const zombieCode = "601051";
      const responderCode = "601052";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragonTreasureCode),
        { code: dragonCode, name: "Dragon Treasure Dragon Target", kind: "monster" as const, typeFlags: 0x1, race: 0x2000, level: 4, attack: 1200, defense: 900 },
        { code: zombieCode, name: "Dragon Treasure Zombie Decoy", kind: "monster" as const, typeFlags: 0x1, race: 0x10, level: 4, attack: 1300, defense: 1100 },
        { code: responderCode, name: "Dragon Treasure Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 310, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [dragonTreasureCode, dragonCode, zombieCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const dragonTreasure = session.state.cards.find((card) => card.code === dragonTreasureCode);
      const dragon = session.state.cards.find((card) => card.code === dragonCode);
      const zombie = session.state.cards.find((card) => card.code === zombieCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(dragonTreasure).toBeDefined();
      expect(dragon).toBeDefined();
      expect(zombie).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, dragonTreasure!.uid, "hand", 0);
      moveDuelCard(session.state, dragon!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, zombie!.uid, "monsterZone", 0).position = "faceUpAttack";
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
      expect(host.loadCardScript(Number(dragonTreasureCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === dragonTreasure!.uid);
      expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

      expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
      expect(restoredEquipWindow.session.state.chain[0]).toEqual({
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        id: "chain-2",
        operationInfos: [
          {
            category: 0x40000,
            count: 1,
            parameter: 0,
            player: 0,
            targetUids: [dragonTreasure!.uid],
          },
        ],
        player: 0,
        sourceUid: dragonTreasure!.uid,
        targetUids: [dragon!.uid],
      });
      expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(zombie!.uid);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === dragonTreasure!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: dragon!.uid,
        faceUp: true,
      });
      const restoredZombie = restoredChain.session.state.cards.find((card) => card.uid === zombie!.uid);
      expect(restoredZombie).toMatchObject({ location: "monsterZone" });
      expect(restoredZombie?.equippedToUid).toBeUndefined();

      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      const restoredAttackBoost = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === dragonTreasure!.uid && effect.code === 100);
      const restoredDefenseBoost = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === dragonTreasure!.uid && effect.code === 104);
      expect(restoredAttackBoost?.event).toBe("continuous");
      expect(restoredAttackBoost?.range).toEqual(["spellTrapZone"]);
      expect(restoredAttackBoost?.value).toBe(300);
      expect(restoredDefenseBoost?.event).toBe("continuous");
      expect(restoredDefenseBoost?.range).toEqual(["spellTrapZone"]);
      expect(restoredDefenseBoost?.value).toBe(300);
      expectLuaEquipStatProbe(restoredEquipState, dragonCode, dragonTreasureCode, "equip stat probe 1435851/1500/1200");
    });

    it("restores Burning Spear attribute-filtered equip target and mixed attack/defense stats", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const burningSpearCode = "18937875";
      const fireTargetCode = "601053";
      const waterDecoyCode = "601054";
      const responderCode = "601055";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === burningSpearCode),
        { code: fireTargetCode, name: "Burning Spear FIRE Target", kind: "monster" as const, typeFlags: 0x1, attribute: 0x4, level: 4, attack: 1000, defense: 1000 },
        { code: waterDecoyCode, name: "Burning Spear WATER Decoy", kind: "monster" as const, typeFlags: 0x1, attribute: 0x2, level: 4, attack: 1200, defense: 1200 },
        { code: responderCode, name: "Burning Spear Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [burningSpearCode, waterDecoyCode, fireTargetCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const burningSpear = session.state.cards.find((card) => card.code === burningSpearCode);
      const fireTarget = session.state.cards.find((card) => card.code === fireTargetCode);
      const waterDecoy = session.state.cards.find((card) => card.code === waterDecoyCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(burningSpear).toBeDefined();
      expect(fireTarget).toBeDefined();
      expect(waterDecoy).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, burningSpear!.uid, "hand", 0);
      moveDuelCard(session.state, waterDecoy!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, fireTarget!.uid, "monsterZone", 0).position = "faceUpAttack";
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
      expect(host.loadCardScript(Number(burningSpearCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === burningSpear!.uid);
      expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

      expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
      expect(restoredEquipWindow.session.state.chain[0]?.targetUids).toEqual([fireTarget!.uid]);
      expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(waterDecoy!.uid);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === burningSpear!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: fireTarget!.uid,
        faceUp: true,
      });
      const restoredWaterDecoy = restoredChain.session.state.cards.find((card) => card.uid === waterDecoy!.uid);
      expect(restoredWaterDecoy).toMatchObject({ location: "monsterZone" });
      expect(restoredWaterDecoy?.equippedToUid).toBeUndefined();

      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      const restoredAttackBoost = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === burningSpear!.uid && effect.code === 100);
      const restoredDefenseLoss = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === burningSpear!.uid && effect.code === 104);
      expect(restoredAttackBoost?.event).toBe("continuous");
      expect(restoredAttackBoost?.range).toEqual(["spellTrapZone"]);
      expect(restoredAttackBoost?.value).toBe(400);
      expect(restoredDefenseLoss?.event).toBe("continuous");
      expect(restoredDefenseLoss?.range).toEqual(["spellTrapZone"]);
      expect(restoredDefenseLoss?.value).toBe(-200);
      expectLuaEquipStatProbe(restoredEquipState, fireTargetCode, burningSpearCode, "equip stat probe 18937875/1400/800");
    });

    it("restores Black Pendant equip stat and sent-from-field damage trigger", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const pendantCode = "65169794";
      const targetCode = "601024";
      const responderCode = "601025";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pendantCode),
        { code: targetCode, name: "Black Pendant Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: responderCode, name: "Black Pendant Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [pendantCode, targetCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const pendant = session.state.cards.find((card) => card.code === pendantCode);
      const target = session.state.cards.find((card) => card.code === targetCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(pendant).toBeDefined();
      expect(target).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, pendant!.uid, "hand", 0);
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
      expect(host.loadCardScript(Number(pendantCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
      expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === pendant!.uid);
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
                "p0-deck-65169794-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-65169794-0",
          "targetUids": [
            "p0-deck-601024-1",
          ],
        }
      `);
      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === pendant!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: target!.uid,
        faceUp: true,
      });
      const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredEquipState);
      expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
      expectLuaEquipProbe(restoredEquipState, targetCode, pendantCode, "equip probe 65169794/1500");

      destroyDuelCard(restoredEquipState.session.state, pendant!.uid, 0, duelReason.effect | duelReason.destroy, 0);
      expect(restoredEquipState.session.state.cards.find((card) => card.uid === pendant!.uid)).toMatchObject({
        location: "graveyard",
        previousLocation: "spellTrapZone",
        previousEquippedToUid: target!.uid,
      });
      expect(restoredEquipState.session.state.pendingTriggers).toMatchInlineSnapshot(`
        [
          {
            "effectId": "lua-4-1014",
            "eventCardUid": "p0-deck-65169794-0",
            "eventCode": 1014,
            "eventCurrentState": {
              "controller": 0,
              "faceUp": true,
              "location": "graveyard",
              "position": "faceUpAttack",
              "sequence": 0,
            },
            "eventName": "sentToGraveyard",
            "eventPreviousState": {
              "controller": 0,
              "faceUp": true,
              "location": "spellTrapZone",
              "position": "faceUpAttack",
              "sequence": 0,
            },
            "eventReason": 65,
            "eventReasonCardUid": "p0-deck-65169794-0",
            "eventReasonEffectId": 1,
            "eventReasonPlayer": 0,
            "eventTriggerTiming": "when",
            "id": "trigger-6-1",
            "player": 0,
            "sourceUid": "p0-deck-65169794-0",
            "triggerBucket": "turnMandatory",
          },
        ]
      `);

      const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
      expectCleanRestore(restoredTriggerWindow);
      expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
      const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === pendant!.uid);
      expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

      expect(restoredTriggerWindow.session.state.chain[0]).toMatchInlineSnapshot(`
        {
          "activationLocation": "graveyard",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-4-1014",
          "eventCardUid": "p0-deck-65169794-0",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "spellTrapZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-65169794-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "chain-6",
          "operationInfos": [
            {
              "category": 524288,
              "count": 0,
              "parameter": 500,
              "player": 1,
              "targetUids": [],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-65169794-0",
          "targetParam": 500,
          "targetPlayer": 1,
        }
      `);
      expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

      const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
      expectCleanRestore(restoredDamageChain);
      expectRestoredLegalActions(restoredDamageChain, restoredDamageChain.session.state.waitingFor ?? restoredDamageChain.session.state.turnPlayer);
      expect(restoredDamageChain.session.state.chain[0]).toEqual(restoredTriggerWindow.session.state.chain[0]!);
      resolveRestoredChain(restoredDamageChain);

      expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(7500);
      expect(restoredDamageChain.session.state.log).toContainEqual(expect.objectContaining({ action: "effectDamage", player: 1, detail: "500" }));
      expect(restoredDamageChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredDamageChain.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === pendant!.uid)).toEqual([
        {
          eventName: "sentToGraveyard",
          eventCode: 1014,
          eventCardUid: pendant!.uid,
          eventReason: duelReason.effect | duelReason.destroy,
          eventReasonPlayer: 0,
          eventReasonCardUid: pendant!.uid,
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
      expect(restoredDamageChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
        {
          eventName: "damageDealt",
          eventCode: 1111,
          eventPlayer: 1,
          eventValue: 500,
          eventReason: duelReason.effect,
          eventReasonPlayer: 0,
          eventReasonCardUid: pendant!.uid,
          eventReasonEffectId: 4,
        },
      ]);
    });

    it("restores United We Stand dynamic equip stat callbacks", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const unitedCode = "56747793";
      const targetCode = "601021";
      const allyCode = "601022";
      const responderCode = "601023";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === unitedCode),
        { code: targetCode, name: "United We Stand Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: allyCode, name: "United We Stand Face-up Ally", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1200, defense: 1200 },
        { code: responderCode, name: "United We Stand Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 305, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [unitedCode, targetCode, allyCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const united = session.state.cards.find((card) => card.code === unitedCode);
      const target = session.state.cards.find((card) => card.code === targetCode);
      const ally = session.state.cards.find((card) => card.code === allyCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(united).toBeDefined();
      expect(target).toBeDefined();
      expect(ally).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, united!.uid, "hand", 0);
      moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, ally!.uid, "monsterZone", 0).position = "faceUpAttack";
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
      expect(host.loadCardScript(Number(unitedCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
      expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === united!.uid);
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
                "p0-deck-56747793-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-56747793-0",
          "targetUids": [
            "p0-deck-601021-1",
          ],
        }
      `);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(restoredChain.session.state.chain[0]).toEqual(restoredEquipWindow.session.state.chain[0]!);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.session.state.cards.find((card) => card.uid === united!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: target!.uid,
        faceUp: true,
      });
      expect(restoredChain.host.messages).not.toContain("equip responder resolved");

      const restoredTwoMonsters = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredTwoMonsters);
      expectRestoredLegalActions(restoredTwoMonsters, restoredTwoMonsters.session.state.waitingFor ?? restoredTwoMonsters.session.state.turnPlayer);
      expect(restoredTwoMonsters.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === united!.uid && [100, 104].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
        [
          {
            "battleDamageValue": [Function],
            "canActivate": [Function],
            "code": 100,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-3-100",
            "lifePointValue": [Function],
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:56747793:lua-3-100",
            "sourceUid": "p0-deck-56747793-0",
            "statValue": [Function],
            "target": [Function],
            "valueCardPredicate": [Function],
            "valuePredicate": [Function],
          },
          {
            "battleDamageValue": [Function],
            "canActivate": [Function],
            "code": 104,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-4-104",
            "lifePointValue": [Function],
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:56747793:lua-4-104",
            "sourceUid": "p0-deck-56747793-0",
            "statValue": [Function],
            "target": [Function],
            "valueCardPredicate": [Function],
            "valuePredicate": [Function],
          },
        ]
      `);
      expectLuaEquipStatProbe(restoredTwoMonsters, targetCode, unitedCode, "equip stat probe 56747793/2600/2600");

      moveDuelCard(restoredTwoMonsters.session.state, ally!.uid, "graveyard", 0);
      const restoredOneMonster = restoreDuelWithLuaScripts(serializeDuel(restoredTwoMonsters.session), source, reader);
      expectCleanRestore(restoredOneMonster);
      expectRestoredLegalActions(restoredOneMonster, restoredOneMonster.session.state.waitingFor ?? restoredOneMonster.session.state.turnPlayer);
      expectLuaEquipStatProbe(restoredOneMonster, targetCode, unitedCode, "equip stat probe 56747793/1800/1800");
    });

    it("restores Mage Power dynamic Spell/Trap-count equip stat callbacks", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const magePowerCode = "83746708";
      const targetCode = "601026";
      const extraBackrowCode = "601027";
      const responderCode = "601028";
      const cards = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === magePowerCode),
        { code: targetCode, name: "Mage Power Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
        { code: extraBackrowCode, name: "Mage Power Extra Backrow", kind: "spell" as const, typeFlags: 0x2 },
        { code: responderCode, name: "Mage Power Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 307, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [magePowerCode, targetCode, extraBackrowCode] }, 1: { main: [responderCode] } });
      startDuel(session);

      const magePower = session.state.cards.find((card) => card.code === magePowerCode);
      const target = session.state.cards.find((card) => card.code === targetCode);
      const extraBackrow = session.state.cards.find((card) => card.code === extraBackrowCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      expect(magePower).toBeDefined();
      expect(target).toBeDefined();
      expect(extraBackrow).toBeDefined();
      expect(responder).toBeDefined();
      moveDuelCard(session.state, magePower!.uid, "hand", 0);
      moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
      moveDuelCard(session.state, extraBackrow!.uid, "spellTrapZone", 0).position = "faceDown";
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
      expect(host.loadCardScript(Number(magePowerCode), source).ok).toBe(true);
      expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(2);

      const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
      expectCleanRestore(restoredEquipWindow);
      expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
      expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
      expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
      const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === magePower!.uid);
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
                "p0-deck-83746708-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-83746708-0",
          "targetUids": [
            "p0-deck-601026-1",
          ],
        }
      `);

      const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
      expectCleanRestore(restoredChain);
      expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
      expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
      resolveRestoredChain(restoredChain);

      expect(restoredChain.host.messages).not.toContain("equip responder resolved");
      expect(restoredChain.session.state.cards.find((card) => card.uid === magePower!.uid)).toMatchObject({
        location: "spellTrapZone",
        equippedToUid: target!.uid,
        faceUp: true,
      });

      const restoredTwoBackrow = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
      expectCleanRestore(restoredTwoBackrow);
      expectRestoredLegalActions(restoredTwoBackrow, restoredTwoBackrow.session.state.waitingFor ?? restoredTwoBackrow.session.state.turnPlayer);
      expect(restoredTwoBackrow.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === magePower!.uid && [100, 104].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
        [
          {
            "battleDamageValue": [Function],
            "canActivate": [Function],
            "code": 100,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-3-100",
            "lifePointValue": [Function],
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:83746708:lua-3-100",
            "sourceUid": "p0-deck-83746708-0",
            "statValue": [Function],
            "target": [Function],
            "valueCardPredicate": [Function],
            "valuePredicate": [Function],
          },
          {
            "battleDamageValue": [Function],
            "canActivate": [Function],
            "code": 104,
            "controller": 0,
            "cost": [Function],
            "event": "continuous",
            "id": "lua-4-104",
            "lifePointValue": [Function],
            "luaTypeFlags": 4,
            "oncePerTurn": false,
            "operation": [Function],
            "range": [
              "spellTrapZone",
            ],
            "registryKey": "lua:83746708:lua-4-104",
            "sourceUid": "p0-deck-83746708-0",
            "statValue": [Function],
            "target": [Function],
            "valueCardPredicate": [Function],
            "valuePredicate": [Function],
          },
        ]
      `);
      expectLuaEquipStatProbe(restoredTwoBackrow, targetCode, magePowerCode, "equip stat probe 83746708/2000/2000");

      moveDuelCard(restoredTwoBackrow.session.state, extraBackrow!.uid, "graveyard", 0);
      const restoredOneBackrow = restoreDuelWithLuaScripts(serializeDuel(restoredTwoBackrow.session), source, reader);
      expectCleanRestore(restoredOneBackrow);
      expectRestoredLegalActions(restoredOneBackrow, restoredOneBackrow.session.state.waitingFor ?? restoredOneBackrow.session.state.turnPlayer);
      expectLuaEquipStatProbe(restoredOneBackrow, targetCode, magePowerCode, "equip stat probe 83746708/1500/1500");
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
