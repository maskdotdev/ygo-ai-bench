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
    expect(restoredDeckChain.session.state.chain[0]).toMatchObject(restoredTriggerWindow.session.state.chain[0]!);
    resolveRestoredChain(restoredDeckChain);

    expect(restoredDeckChain.session.state.cards.find((card) => card.uid === nuzzler!.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      sequence: 0,
    });
    expect(restoredDeckChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredDeckChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: nuzzler!.uid }),
        expect.objectContaining({ eventName: "lifePointCostPaid", eventCode: 1201, eventPlayer: 0, eventValue: 500 }),
        expect.objectContaining({ eventName: "sentToDeck", eventCode: 1013, eventCardUid: nuzzler!.uid }),
      ]),
    );
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
