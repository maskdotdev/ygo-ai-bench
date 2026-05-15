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
  it("restores Malevolent Nuzzler equip stat and paid top-of-Deck trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nuzzlerCode = "99597615";
    const targetCode = "601037";
    const responderCode = "601038";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nuzzlerCode),
      { code: targetCode, name: "Malevolent Nuzzler Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Malevolent Nuzzler Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nuzzlerCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const nuzzler = session.state.cards.find((card) => card.code === nuzzlerCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(nuzzler).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, nuzzler!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(nuzzlerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === nuzzler!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: nuzzler!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [nuzzler!.uid], count: 1, player: 0, parameter: 0 }],
    });
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === nuzzler!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expectLuaEquipProbe(restoredEquipState, targetCode, nuzzlerCode, "equip probe 99597615/1700");

    destroyDuelCard(restoredEquipState.session.state, nuzzler!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === nuzzler!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: target!.uid,
    });
    expect(restoredEquipState.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: nuzzler!.uid, eventName: "sentToGraveyard", eventCardUid: nuzzler!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === nuzzler!.uid);
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

    expect(restoredTriggerWindow.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: nuzzler!.uid,
      operationInfos: [{ category: 0x10, targetUids: [nuzzler!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredDeckChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredDeckChain);
    expectRestoredLegalActions(restoredDeckChain, restoredDeckChain.session.state.waitingFor ?? restoredDeckChain.session.state.turnPlayer);
    expect(restoredDeckChain.session.state.chain[0]).toMatchObject(restoredTriggerWindow.session.state.chain[0]!);
    resolveRestoredChain(restoredDeckChain);

    expect(restoredDeckChain.session.state.cards.find((card) => card.uid === nuzzler!.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      sequence: 0,
    });
    expect(restoredDeckChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredDeckChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "lifePointCostPaid", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: nuzzler!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: nuzzler!.uid,
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
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: nuzzler!.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: nuzzler!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: nuzzler!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "deck",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });

  it("restores Butterfly Dagger leave-field return trigger with previous equip target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const daggerCode = "69243953";
    const targetCode = "601039";
    const responderCode = "601040";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === daggerCode),
      { code: targetCode, name: "Butterfly Dagger Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Butterfly Dagger Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [daggerCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const dagger = session.state.cards.find((card) => card.code === daggerCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(dagger).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, dagger!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(daggerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === dagger!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: dagger!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [dagger!.uid], count: 1, player: 0, parameter: 0 }],
    });
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === dagger!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expectLuaEquipProbe(restoredEquipState, targetCode, daggerCode, "equip probe 69243953/1300");

    destroyDuelCard(restoredEquipState.session.state, dagger!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === dagger!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: target!.uid,
    });
    expect(restoredEquipState.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: dagger!.uid, eventName: "leftField", eventCardUid: dagger!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === dagger!.uid);
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: dagger!.uid,
      operationInfos: [{ category: 0x8, targetUids: [dagger!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredReturnChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredReturnChain);
    expectRestoredLegalActions(restoredReturnChain, restoredReturnChain.session.state.waitingFor ?? restoredReturnChain.session.state.turnPlayer);
    expect(restoredReturnChain.session.state.chain[0]).toMatchObject(restoredTriggerWindow.session.state.chain[0]!);
    resolveRestoredChain(restoredReturnChain);

    expect(restoredReturnChain.session.state.cards.find((card) => card.uid === dagger!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
    expect(restoredReturnChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredReturnChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "leftField", eventCode: 1015, eventCardUid: dagger!.uid }),
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: dagger!.uid }),
        expect.objectContaining({ eventName: "confirmed", eventCode: 1211, eventUids: [dagger!.uid] }),
      ]),
    );
  });

  it("restores Horn of the Unicorn sent-from-field top-of-Deck trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hornCode = "64047146";
    const targetCode = "601041";
    const responderCode = "601042";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hornCode),
      { code: targetCode, name: "Horn of the Unicorn Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Horn of the Unicorn Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 313, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hornCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const horn = session.state.cards.find((card) => card.code === hornCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(horn).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, horn!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(hornCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === horn!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: horn!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [horn!.uid], count: 1, player: 0, parameter: 0 }],
    });
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === horn!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expectLuaEquipProbe(restoredEquipState, targetCode, hornCode, "equip probe 64047146/1700");

    destroyDuelCard(restoredEquipState.session.state, horn!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === horn!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: target!.uid,
    });
    expect(restoredEquipState.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: horn!.uid, eventName: "sentToGraveyard", eventCardUid: horn!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === horn!.uid);
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: horn!.uid,
      operationInfos: [{ category: 0x10, targetUids: [horn!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredDeckChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredDeckChain);
    expectRestoredLegalActions(restoredDeckChain, restoredDeckChain.session.state.waitingFor ?? restoredDeckChain.session.state.turnPlayer);
    expect(restoredDeckChain.session.state.chain[0]).toMatchObject(restoredTriggerWindow.session.state.chain[0]!);
    resolveRestoredChain(restoredDeckChain);

    expect(restoredDeckChain.session.state.cards.find((card) => card.uid === horn!.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      sequence: 0,
    });
    expect(restoredDeckChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredDeckChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: horn!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: horn!.uid,
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
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: horn!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: horn!.uid,
        eventReasonEffectId: 5,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "deck",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });

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

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: smoke!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [smoke!.uid], count: 1, player: 0, parameter: 0 }],
    });
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
    expect(restoredEquipState.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: smoke!.uid, eventName: "leftField", eventCardUid: smoke!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === smoke!.uid);
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: smoke!.uid,
      operationInfos: [{ category: 0x80, targetUids: [], count: 0, player: 1, parameter: 1 }],
    });
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredDiscardChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredDiscardChain);
    expectRestoredLegalActions(restoredDiscardChain, restoredDiscardChain.session.state.waitingFor ?? restoredDiscardChain.session.state.turnPlayer);
    expect(restoredDiscardChain.session.state.chain[0]).toMatchObject(restoredTriggerWindow.session.state.chain[0]!);
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
    expect(restoredDiscardChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "leftField", eventCode: 1015, eventCardUid: smoke!.uid }),
        expect.objectContaining({ eventName: "confirmed", eventCode: 1211, eventPlayer: 0, eventUids: confirmedOpponentHandUids }),
        expect.objectContaining({ eventName: "discarded", eventCode: 1018, eventCardUid: discardedCards[0]!.uid }),
      ]),
    );
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

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: blast!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [blast!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(restoredActivation.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: blast!.uid, event: "continuous", code: 17, range: ["spellTrapZone"] })]),
    );

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
    expect(restoredEquipped.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: blast!.uid, eventName: "leftField", eventCardUid: blast!.uid, player: 0 }),
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, restoredTrigger.session.state.waitingFor ?? restoredTrigger.session.state.turnPlayer);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === blast!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.chain[0]).toMatchObject({
      sourceUid: blast!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(getLuaRestoreLegalActions(restoredTrigger, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredDestroyChain);
    expectRestoredLegalActions(restoredDestroyChain, restoredDestroyChain.session.state.waitingFor ?? restoredDestroyChain.session.state.turnPlayer);
    expect(restoredDestroyChain.session.state.chain[0]).toMatchObject(restoredTrigger.session.state.chain[0]!);
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
