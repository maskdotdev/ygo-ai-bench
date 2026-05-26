import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Burden of the Mighty dynamic stat", () => {
  it("restores official field ATK update callback by monster Level", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const burdenCode = "44947065";
    const defenderCode = "614201";
    const lowAttackerCode = "614202";
    const highAttackerCode = "614203";
    const responderCode = "614204";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === burdenCode),
      { code: defenderCode, name: "Burden of the Mighty Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: lowAttackerCode, name: "Burden of the Mighty Level 3 Attacker", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1600, defense: 1000 },
      { code: highAttackerCode, name: "Burden of the Mighty Level 6 Attacker", kind: "monster", typeFlags: typeMonster, level: 6, attack: 2400, defense: 1200 },
      { code: responderCode, name: "Burden of the Mighty Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4494, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [burdenCode, defenderCode] }, 1: { main: [lowAttackerCode, highAttackerCode, responderCode] } });
    startDuel(session);

    const burden = session.state.cards.find((card) => card.code === burdenCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const lowAttacker = session.state.cards.find((card) => card.code === lowAttackerCode);
    const highAttacker = session.state.cards.find((card) => card.code === highAttackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(burden).toBeDefined();
    expect(defender).toBeDefined();
    expect(lowAttacker).toBeDefined();
    expect(highAttacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, burden!.uid, "spellTrapZone", 0);
    burden!.position = "faceDown";
    burden!.faceUp = false;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    moveDuelCard(session.state, lowAttacker!.uid, "monsterZone", 1);
    lowAttacker!.position = "faceUpAttack";
    lowAttacker!.faceUp = true;
    moveDuelCard(session.state, highAttacker!.uid, "monsterZone", 1);
    highAttacker!.position = "faceUpAttack";
    highAttacker!.faceUp = true;
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
    expect(host.loadCardScript(Number(burdenCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === burden!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-44947065-0",
      }
    `);
    expect(restoredActivation.session.state.chain[0]?.targetUids ?? []).toEqual([]);
    expect(restoredActivation.session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === burden!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("burden of the mighty responder resolved");

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredStat.restoreComplete, restoredStat.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredStat, 0);
    expect(restoredStat.missingRegistryKeys).toEqual([]);
    expect(restoredStat.missingChainLimitRegistryKeys).toEqual([]);
    const probe = restoredStat.host.loadScript(statProbeScript(defenderCode, lowAttackerCode, highAttackerCode), "burden-mighty-stat-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredStat.host.messages).toContain("burden of the mighty attack 1000/1300/1800");

    restoredStat.session.state.turnPlayer = 1;
    restoredStat.session.state.phase = "battle";
    restoredStat.session.state.waitingFor = 1;
    const attack = getLuaRestoreLegalActions(restoredStat, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === highAttacker!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStat, attack!);
    passBattleResponses(restoredStat);

    expect(restoredStat.session.state.battleDamage[0]).toBe(800);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: highAttacker!.uid,
        eventPlayer: 0,
        eventValue: 800,
        eventReason: duelReason.battle,
        eventReasonCardUid: highAttacker!.uid,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restoredStat.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredStat.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredStat.session.state.cards.find((card) => card.uid === highAttacker!.uid)).toMatchObject({ location: "monsterZone" });
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
      e:SetOperation(function(e,tp) Debug.Message("burden of the mighty responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function statProbeScript(defenderCode: string, lowAttackerCode: string, highAttackerCode: string): string {
  return `
    local defender=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${defenderCode}),0,LOCATION_MZONE,0,nil)
    local low=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowAttackerCode}),0,0,LOCATION_MZONE,nil)
    local high=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highAttackerCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message("burden of the mighty attack " .. defender:GetAttack() .. "/" .. low:GetAttack() .. "/" .. high:GetAttack())
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
