import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  sendDuelCardToGraveyard,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Snatch Steal equip control", () => {
  it("restores Snatch Steal's equip control and returns control when the equip leaves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const snatchCode = "45986603";
    const targetCode = "612501";
    const responderCode = "612502";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === snatchCode),
      { code: targetCode, name: "Snatch Steal Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Snatch Steal Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [snatchCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const snatch = session.state.cards.find((card) => card.code === snatchCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(snatch).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, snatch!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(snatchCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === snatch!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: snatch!.uid,
      targetUids: [target!.uid],
    });
    expect(restoredEquipWindow.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x2000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x40000, targetUids: [snatch!.uid], count: 1, player: 0, parameter: 0 },
    ]);
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredChain.session.state.chain[0]).toMatchObject(restoredEquipWindow.session.state.chain[0]!);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === snatch!.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredChain.host.messages).not.toContain("snatch responder resolved");

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredControl.restoreComplete, restoredControl.incompleteReasons.join("; ")).toBe(true);
    expect(restoredControl.missingRegistryKeys).toEqual([]);
    expect(restoredControl.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredControl, 0);
    expectLuaSnatchProbe(restoredControl, targetCode, snatchCode, "snatch probe 0/45986603/612501");

    sendDuelCardToGraveyard(restoredControl.session.state, snatch!.uid, 0);
    expect(restoredControl.session.state.cards.find((card) => card.uid === snatch!.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target!.uid,
    });
    expect(restoredControl.session.state.cards.find((card) => card.uid === snatch!.uid)?.equippedToUid).toBeUndefined();
    expect(restoredControl.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
    });

    const restoredReturned = restoreDuelWithLuaScripts(serializeDuel(restoredControl.session), source, reader);
    expect(restoredReturned.restoreComplete, restoredReturned.incompleteReasons.join("; ")).toBe(true);
    expect(restoredReturned.missingRegistryKeys).toEqual([]);
    expect(restoredReturned.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredReturned, 0);
    expectLuaSnatchProbe(restoredReturned, targetCode, snatchCode, "snatch probe 1/nil/nil");
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
      e:SetOperation(function(e,tp) Debug.Message("snatch responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function expectLuaSnatchProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, snatchCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target0=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local target1=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local target=target0 or target1
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${snatchCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipCode=equip and equip:GetCode() or "nil"
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("snatch probe " .. target:GetControler() .. "/" .. equipCode .. "/" .. equipTargetCode)
    `,
    "snatch-steal-equip-control-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
