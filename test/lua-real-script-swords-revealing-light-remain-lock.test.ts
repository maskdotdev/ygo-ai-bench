import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Swords of Revealing Light remain lock", () => {
  it("restores position reveal, remain-field state, and opponent attack restriction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const swordsCode = "72302403";
    const defenderCode = "614401";
    const attackerCode = "614402";
    const hiddenCode = "614403";
    const responderCode = "614404";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === swordsCode),
      { code: defenderCode, name: "Swords of Revealing Light Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Swords of Revealing Light Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: hiddenCode, name: "Swords of Revealing Light Hidden Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1500 },
      { code: responderCode, name: "Swords of Revealing Light Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7230, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [swordsCode, defenderCode] }, 1: { main: [attackerCode, hiddenCode, responderCode] } });
    startDuel(session);

    const swords = session.state.cards.find((card) => card.code === swordsCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const hidden = session.state.cards.find((card) => card.code === hiddenCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(swords).toBeDefined();
    expect(defender).toBeDefined();
    expect(attacker).toBeDefined();
    expect(hidden).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, swords!.uid, "hand", 0);
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, hidden!.uid, "monsterZone", 1);
    hidden!.position = "faceDownDefense";
    hidden!.faceUp = false;
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
    expect(host.loadCardScript(Number(swordsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === swords!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: swords!.uid,
      operationInfos: [{ category: 0x1000, targetUids: [hidden!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === swords!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
      turnCounter: 0,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === hidden!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("swords of revealing light responder resolved");

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    const probe = restoredLock.host.loadScript(attackLockProbeScript(attackerCode, hiddenCode), "swords-revealing-light-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredLock.host.messages).toContain("swords of revealing light state false/true/4");

    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.phase = "battle";
    restoredLock.session.state.waitingFor = 1;
    const battleActions = getLuaRestoreLegalActions(restoredLock, 1).filter((action) => action.type === "declareAttack");
    expect(battleActions.some((action) => action.attackerUid === attacker!.uid)).toBe(false);

    let restoredMaintenance = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredMaintenance.restoreComplete, restoredMaintenance.incompleteReasons.join("; ")).toBe(true);
    expect(restoredMaintenance.missingRegistryKeys).toEqual([]);
    advanceOpponentEndPhase(restoredMaintenance);
    expect(restoredMaintenance.session.state.cards.find((card) => card.uid === swords!.uid)).toMatchObject({
      location: "spellTrapZone",
      turnCounter: 1,
    });
    restoredMaintenance = restoreDuelWithLuaScripts(serializeDuel(restoredMaintenance.session), source, reader);
    expect(restoredMaintenance.restoreComplete, restoredMaintenance.incompleteReasons.join("; ")).toBe(true);
    expect(restoredMaintenance.missingRegistryKeys).toEqual([]);
    advanceOpponentEndPhase(restoredMaintenance);
    expect(restoredMaintenance.session.state.cards.find((card) => card.uid === swords!.uid)).toMatchObject({
      location: "spellTrapZone",
      turnCounter: 2,
    });
    restoredMaintenance = restoreDuelWithLuaScripts(serializeDuel(restoredMaintenance.session), source, reader);
    expect(restoredMaintenance.restoreComplete, restoredMaintenance.incompleteReasons.join("; ")).toBe(true);
    expect(restoredMaintenance.missingRegistryKeys).toEqual([]);
    advanceOpponentEndPhase(restoredMaintenance);
    expect(restoredMaintenance.session.state.cards.find((card) => card.uid === swords!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: 0x401,
      turnCounter: 3,
    });
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
      e:SetOperation(function(e,tp) Debug.Message("swords of revealing light responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function attackLockProbeScript(attackerCode: string, hiddenCode: string): string {
  return `
    local attacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${attackerCode}),0,0,LOCATION_MZONE,nil)
    local hidden=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${hiddenCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message(
      "swords of revealing light state " ..
      tostring(attacker:CanAttack()) .. "/" ..
      tostring(hidden:IsFaceup()) .. "/" ..
      hidden:GetPosition()
    )
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

function advanceOpponentEndPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  restored.session.state.turn += 1;
  restored.session.state.turnPlayer = 1;
  restored.session.state.phase = "main2";
  restored.session.state.waitingFor = 1;
  const endPhase = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "changePhase" && action.phase === "end");
  expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, endPhase!);
}
