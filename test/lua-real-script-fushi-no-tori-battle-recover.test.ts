import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fushi No Tori battle recover", () => {
  it("restores its battle-damage trigger into CHAININFO target-param LP recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fushiCode = "38538445";
    const defenderCode = "38538446";
    const responderCode = "38538447";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fushiCode),
      { code: defenderCode, name: "Fushi No Tori Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 500, defense: 500 },
      { code: responderCode, name: "Fushi No Tori Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 385, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fushiCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const fushi = session.state.cards.find((card) => card.code === fushiCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(fushi).toBeDefined();
    expect(defender).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, fushi!.uid, "monsterZone", 0);
    fushi!.position = "faceUpAttack";
    fushi!.faceUp = true;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fushiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    expect(restoredSetup.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === fushi!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);

    expect(restoredSetup.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredSetup.session.state.players[1].lifePoints).toBe(7300);
    expect(restoredSetup.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: fushi!.uid,
          eventName: "battleDamageDealt",
          eventCode: 1143,
          eventPlayer: 1,
          eventValue: 700,
        }),
      ]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === fushi!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain[0]).toMatchObject({
      sourceUid: fushi!.uid,
      eventName: "battleDamageDealt",
      eventPlayer: 1,
      eventValue: 700,
      targetPlayer: 0,
      targetParam: 700,
      operationInfos: [{ category: 0x100000, targetUids: [], count: 0, player: 0, parameter: 700 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChain.session.state.players[0].lifePoints).toBe(8700);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7300);
    expect(restoredChain.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === fushi!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 700, eventCardUid: fushi!.uid }),
        expect.objectContaining({ eventName: "recoveredLifePoints", eventCode: 1112, eventPlayer: 0, eventValue: 700 }),
      ]),
    );
    expect(restoredChain.host.messages).not.toContain("fushi responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)
      e:SetHintTiming(TIMING_BATTLE_PHASE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("fushi responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
