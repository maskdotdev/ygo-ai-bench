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

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: axe!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [axe!.uid], count: 1, player: 0, parameter: 0 }],
    });
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.session.state.chain[0]).toMatchObject(restoredEquipWindow.session.state.chain[0]!);
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

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: pendant!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [pendant!.uid], count: 1, player: 0, parameter: 0 }],
    });
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
    expect(restoredEquipState.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: pendant!.uid, eventName: "sentToGraveyard", eventCardUid: pendant!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === pendant!.uid);
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: pendant!.uid,
      targetPlayer: 1,
      targetParam: 500,
      operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 500 }],
    });
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredDamageChain);
    expectRestoredLegalActions(restoredDamageChain, restoredDamageChain.session.state.waitingFor ?? restoredDamageChain.session.state.turnPlayer);
    expect(restoredDamageChain.session.state.chain[0]).toMatchObject(restoredTriggerWindow.session.state.chain[0]!);
    resolveRestoredChain(restoredDamageChain);

    expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredDamageChain.session.state.log).toContainEqual(expect.objectContaining({ action: "effectDamage", player: 1, detail: "500" }));
    expect(restoredDamageChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredDamageChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: pendant!.uid }),
        expect.objectContaining({ eventName: "damageDealt", eventCode: 1111, eventPlayer: 1, eventValue: 500 }),
      ]),
    );
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

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: united!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [united!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.session.state.chain[0]).toMatchObject(restoredEquipWindow.session.state.chain[0]!);
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
    expect(restoredTwoMonsters.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: united!.uid, event: "continuous", code: 100 }),
        expect.objectContaining({ sourceUid: united!.uid, event: "continuous", code: 104 }),
      ]),
    );
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

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: magePower!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [magePower!.uid], count: 1, player: 0, parameter: 0 }],
    });

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
    expect(restoredTwoBackrow.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: magePower!.uid, event: "continuous", code: 100 }),
        expect.objectContaining({ sourceUid: magePower!.uid, event: "continuous", code: 104 }),
      ]),
    );
    expectLuaEquipStatProbe(restoredTwoBackrow, targetCode, magePowerCode, "equip stat probe 83746708/2000/2000");

    moveDuelCard(restoredTwoBackrow.session.state, extraBackrow!.uid, "graveyard", 0);
    const restoredOneBackrow = restoreDuelWithLuaScripts(serializeDuel(restoredTwoBackrow.session), source, reader);
    expectCleanRestore(restoredOneBackrow);
    expectRestoredLegalActions(restoredOneBackrow, restoredOneBackrow.session.state.waitingFor ?? restoredOneBackrow.session.state.turnPlayer);
    expectLuaEquipStatProbe(restoredOneBackrow, targetCode, magePowerCode, "equip stat probe 83746708/1500/1500");
  });

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

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: shield!.uid,
      targetUids: [gladiator!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [shield!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(offSet!.uid);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.session.state.chain[0]).toMatchObject(restoredEquipWindow.session.state.chain[0]!);
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

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: base!.uid,
      targetUids: [opponentTarget!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [base!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.session.state.chain[0]).toMatchObject(restoredEquipWindow.session.state.chain[0]!);
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
    expect(restoredEquipState.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: base!.uid, event: "continuous", code: 73 }),
        expect.objectContaining({ sourceUid: base!.uid, event: "continuous", code: 346 }),
      ]),
    );
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
    expect(restoredBattleWindow.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: base!.uid, eventName: "battleDestroyed", eventCardUid: equippedAttacker!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleWindow.session), workspace, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
    const drawTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === base!.uid);
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, drawTrigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([]);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([]);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === drawCard!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTriggerWindow.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDestroyed", eventCode: 1140, eventCardUid: battleTarget!.uid }),
        expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventValue: 1, eventUids: [drawCard!.uid] }),
      ]),
    );
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
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: base!.uid, eventName: "sentToGraveyard", eventCardUid: base!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, restoredTriggerWindow.session.state.waitingFor ?? restoredTriggerWindow.session.state.turnPlayer);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === base!.uid,
    );
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);

    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: base!.uid,
      targetUids: [skyStriker!.uid],
      operationInfos: [{ category: 0x10, targetUids: [skyStriker!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(restoredTriggerWindow.session.state.chain[0]?.targetUids).not.toContain(offSet!.uid);

    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.session.state.chain[0]).toMatchObject(restoredTriggerWindow.session.state.chain[0]!);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === skyStriker!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSet!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === base!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToDeck", eventCode: 1013, eventCardUid: skyStriker!.uid })]),
    );
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
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
