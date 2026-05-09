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
