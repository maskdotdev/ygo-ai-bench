import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Call of the Haunted revive destroy", () => {
  it("restores Call of the Haunted's Continuous Trap revive and mutual destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const callCode = "97077563";
    const targetCode = "612701";
    const responderCode = "612702";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === callCode),
      { code: targetCode, name: "Call of the Haunted Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
      { code: responderCode, name: "Call of the Haunted Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 307, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [callCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const call = session.state.cards.find((card) => card.code === callCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(call).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, call!.uid, "spellTrapZone", 0);
    call!.position = "faceDown";
    call!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(callCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredActivation, 0));
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === call!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: call!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x200, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    expect(restoredChain.session.state.chain[0]).toMatchObject(restoredActivation.session.state.chain[0]!);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === call!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("call responder resolved");

    const resolvedSnapshot = serializeDuel(restoredChain.session);
    const restoredRevive = restoreDuelWithLuaScripts(resolvedSnapshot, source, reader);
    expect(restoredRevive.restoreComplete, restoredRevive.incompleteReasons.join("; ")).toBe(true);
    expect(restoredRevive.missingRegistryKeys).toEqual([]);
    expectLuaCallProbe(restoredRevive, targetCode, callCode, "call probe 0/612701/1");

    destroyDuelCard(restoredRevive.session.state, call!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRevive.session.state.cards.find((card) => card.uid === call!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredRevive.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    const restoredTrapDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredRevive.session), source, reader);
    expect(restoredTrapDestroyed.restoreComplete, restoredTrapDestroyed.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrapDestroyed.missingRegistryKeys).toEqual([]);

    const restoredTargetDestroy = restoreDuelWithLuaScripts(resolvedSnapshot, source, reader);
    expect(restoredTargetDestroy.restoreComplete, restoredTargetDestroy.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTargetDestroy.missingRegistryKeys).toEqual([]);
    destroyDuelCard(restoredTargetDestroy.session.state, target!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredTargetDestroy.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetDestroy.session.state.cards.find((card) => card.uid === call!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    const restoredMonsterDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredTargetDestroy.session), source, reader);
    expect(restoredMonsterDestroyed.restoreComplete, restoredMonsterDestroyed.incompleteReasons.join("; ")).toBe(true);
    expect(restoredMonsterDestroyed.missingRegistryKeys).toEqual([]);
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
      e:SetOperation(function(e,tp) Debug.Message("call responder resolved") end)
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
  }
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

function expectLuaCallProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, callCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local trap=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${callCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local first=trap and trap:GetFirstCardTarget()
      Debug.Message("call probe " .. target:GetControler() .. "/" .. tostring(first and first:GetCode()) .. "/" .. trap:GetCardTargetCount())
    `,
    "call-of-the-haunted-revive-destroy-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
