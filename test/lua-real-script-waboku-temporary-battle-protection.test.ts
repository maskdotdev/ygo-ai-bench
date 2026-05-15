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
const effectIndestructibleBattle = 42;
const effectAvoidBattleDamage = 201;
const effectFlagPlayerTarget = 0x800;
const resetPhaseEnd = 0x40000200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Waboku temporary battle protection", () => {
  it("restores Trap-registered battle damage prevention and battle indestructibility until the End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wabokuCode = "12607053";
    const defenderCode = "614701";
    const attackerCode = "614702";
    const responderCode = "614703";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wabokuCode),
      { code: defenderCode, name: "Waboku Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Waboku Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Waboku Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1260, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wabokuCode, defenderCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const waboku = session.state.cards.find((card) => card.code === wabokuCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(waboku).toBeDefined();
    expect(defender).toBeDefined();
    expect(attacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, waboku!.uid, "spellTrapZone", 0);
    waboku!.position = "faceDown";
    waboku!.faceUp = false;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wabokuCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === waboku!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({ sourceUid: waboku!.uid });
    expect(restoredActivation.session.state.chain[0]?.targetUids ?? []).toEqual([]);
    expect(restoredActivation.session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === waboku!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
    });
    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: waboku!.uid,
          code: effectAvoidBattleDamage,
          property: effectFlagPlayerTarget,
          value: 1,
          targetRange: [1, 0],
          reset: { flags: resetPhaseEnd },
        }),
        expect.objectContaining({
          sourceUid: waboku!.uid,
          code: effectIndestructibleBattle,
          value: 1,
          targetRange: [4, 0],
          reset: { flags: resetPhaseEnd },
        }),
      ]),
    );
    expect((restoredChain.session.state.effects.find((effect) => effect.sourceUid === waboku!.uid && effect.code === effectAvoidBattleDamage)?.property ?? 0) & effectFlagPlayerTarget).toBe(
      effectFlagPlayerTarget,
    );
    expect(restoredChain.host.messages).not.toContain("waboku responder resolved");

    const restoredProtection = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredProtection.restoreComplete, restoredProtection.incompleteReasons.join("; ")).toBe(true);
    expect(restoredProtection.missingRegistryKeys).toEqual([]);
    expect(restoredProtection.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredProtection.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: waboku!.uid,
          code: effectAvoidBattleDamage,
          property: effectFlagPlayerTarget,
          value: 1,
          targetRange: [1, 0],
          reset: { flags: resetPhaseEnd },
        }),
      ]),
    );
    restoredProtection.session.state.phase = "battle";
    restoredProtection.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredProtection, 1);
    const attack = getLuaRestoreLegalActions(restoredProtection, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredProtection, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredProtection, attack!);
    passBattleResponses(restoredProtection);

    expect(restoredProtection.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredProtection.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredProtection.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredProtection.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "battleDamageDealt", eventPlayer: 0 })]),
    );
    expect(restoredProtection.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredProtection.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    restoredProtection.session.state.phase = "main2";
    restoredProtection.session.state.waitingFor = 1;
    const endPhase = getLuaRestoreLegalActions(restoredProtection, 1).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredProtection, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredProtection, endPhase!);
    expect(restoredProtection.session.state.effects.some((effect) => effect.sourceUid === waboku!.uid && (effect.code === effectAvoidBattleDamage || effect.code === effectIndestructibleBattle))).toBe(false);
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
      e:SetOperation(function(e,tp) Debug.Message("waboku responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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
