import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

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
    expect(host.registerInitialEffects()).toBeGreaterThan(1);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredEquipState.restoreComplete, restoredEquipState.incompleteReasons.join("; ")).toBe(true);
    expectLuaEquipProbe(restoredEquipState, targetCode, axeCode, "equip probe 40619825/2000");
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
    expect(host.registerInitialEffects()).toBeGreaterThan(1);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(1);

    const restoredBlocked = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredBlocked.restoreComplete, restoredBlocked.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredBlocked, 0).some((action) => action.type === "activateEffect" && action.uid === base!.uid)).toBe(false);

    moveDuelCard(restoredBlocked.session.state, blocker!.uid, "graveyard", 0);
    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBlocked.session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredEquipState.restoreComplete, restoredEquipState.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredBattle, 1).some((action) => action.type === "declareAttack" && action.attackerUid === opponentTarget!.uid)).toBe(false);
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
    "axe-of-despair-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
