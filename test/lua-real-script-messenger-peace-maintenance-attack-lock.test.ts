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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Messenger of Peace maintenance attack lock", () => {
  it("restores official ATK-threshold attack restriction and Standby maintenance cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const messengerCode = "44656491";
    const defenderCode = "614101";
    const lowAttackerCode = "614102";
    const highAttackerCode = "614103";
    const responderCode = "614104";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === messengerCode),
      { code: defenderCode, name: "Messenger of Peace Defender", kind: "monster", typeFlags: typeMonster, level: 2, attack: 800, defense: 800 },
      { code: lowAttackerCode, name: "Messenger of Peace Low Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: highAttackerCode, name: "Messenger of Peace High Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: responderCode, name: "Messenger of Peace Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4465, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [messengerCode, defenderCode] }, 1: { main: [lowAttackerCode, highAttackerCode, responderCode] } });
    startDuel(session);

    const messenger = session.state.cards.find((card) => card.code === messengerCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const lowAttacker = session.state.cards.find((card) => card.code === lowAttackerCode);
    const highAttacker = session.state.cards.find((card) => card.code === highAttackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(messenger).toBeDefined();
    expect(defender).toBeDefined();
    expect(lowAttacker).toBeDefined();
    expect(highAttacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, messenger!.uid, "spellTrapZone", 0);
    messenger!.position = "faceDown";
    messenger!.faceUp = false;
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
    expect(host.loadCardScript(Number(messengerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === messenger!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({ sourceUid: messenger!.uid });
    expect(restoredActivation.session.state.chain[0]?.targetUids ?? []).toEqual([]);
    expect(restoredActivation.session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === messenger!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("messenger of peace responder resolved");

    expectMaintenanceCostAfterRestore(restoredChain, source, reader, messenger!.uid);
    expectAttackLockAfterRestore(restoredChain, source, reader, lowAttacker!.uid, highAttacker!.uid, defender!.uid, lowAttackerCode, highAttackerCode);
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
      e:SetOperation(function(e,tp) Debug.Message("messenger of peace responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectMaintenanceCostAfterRestore(
  restoredChain: ReturnType<typeof restoreDuelWithLuaScripts>,
  source: { readScript(name: string): string | undefined },
  reader: ReturnType<typeof createCardReader>,
  messengerUid: string,
): void {
  const maintenanceSeed = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
  expect(maintenanceSeed.restoreComplete, maintenanceSeed.incompleteReasons.join("; ")).toBe(true);
  expect(maintenanceSeed.missingRegistryKeys).toEqual([]);
  expect(maintenanceSeed.missingChainLimitRegistryKeys).toEqual([]);
  expectRestoredLegalActions(maintenanceSeed, 0);
  maintenanceSeed.session.state.phase = "draw";
  maintenanceSeed.session.state.waitingFor = 0;

  const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(maintenanceSeed.session), source, reader);
  expect(restoredDraw.restoreComplete, restoredDraw.incompleteReasons.join("; ")).toBe(true);
  expect(restoredDraw.missingRegistryKeys).toEqual([]);
  expect(restoredDraw.missingChainLimitRegistryKeys).toEqual([]);
  expectRestoredLegalActions(restoredDraw, 0);
  const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
  expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restoredDraw, standby!);

  expect(restoredDraw.session.state.phase).toBe("standby");
  expect(restoredDraw.session.state.players[0].lifePoints).toBe(7900);
  expect(restoredDraw.session.state.cards.find((card) => card.uid === messengerUid)).toMatchObject({
    location: "spellTrapZone",
    faceUp: true,
  });
  expect(restoredDraw.session.state.eventHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ eventName: "lifePointCostPaid", eventCode: 1201, eventPlayer: 0, eventValue: 100, eventReason: duelReason.cost, eventReasonPlayer: 0 }),
    ]),
  );
}

function expectAttackLockAfterRestore(
  restoredChain: ReturnType<typeof restoreDuelWithLuaScripts>,
  source: { readScript(name: string): string | undefined },
  reader: ReturnType<typeof createCardReader>,
  lowAttackerUid: string,
  highAttackerUid: string,
  defenderUid: string,
  lowAttackerCode: string,
  highAttackerCode: string,
): void {
  const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
  expect(restoredPersistent.restoreComplete, restoredPersistent.incompleteReasons.join("; ")).toBe(true);
  expect(restoredPersistent.missingRegistryKeys).toEqual([]);
  expect(restoredPersistent.missingChainLimitRegistryKeys).toEqual([]);
  expectRestoredLegalActions(restoredPersistent, 0);
  const endTurn = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "endTurn");
  expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restoredPersistent, endTurn!);
  expect(restoredPersistent.session.state.turnPlayer).toBe(1);
  expect(restoredPersistent.session.state.phase).toBe("main1");

  const restoredOpponentTurn = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
  expect(restoredOpponentTurn.restoreComplete, restoredOpponentTurn.incompleteReasons.join("; ")).toBe(true);
  expect(restoredOpponentTurn.missingRegistryKeys).toEqual([]);
  expect(restoredOpponentTurn.missingChainLimitRegistryKeys).toEqual([]);
  expectRestoredLegalActions(restoredOpponentTurn, 1);
  const battle = getLuaRestoreLegalActions(restoredOpponentTurn, 1).find((action) => action.type === "changePhase" && action.phase === "battle");
  expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredOpponentTurn, 1), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restoredOpponentTurn, battle!);

  const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpponentTurn.session), source, reader);
  expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
  expect(restoredBattle.missingRegistryKeys).toEqual([]);
  expect(restoredBattle.missingChainLimitRegistryKeys).toEqual([]);
  expectRestoredLegalActions(restoredBattle, 1);
  const battleActions = getLuaRestoreLegalActions(restoredBattle, 1).filter((action) => action.type === "declareAttack");
  expect(battleActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "declareAttack", attackerUid: lowAttackerUid, targetUid: defenderUid })]));
  expect(battleActions.some((action) => action.attackerUid === highAttackerUid)).toBe(false);

  const probe = restoredBattle.host.loadScript(attackLockProbeScript(lowAttackerCode, highAttackerCode), "messenger-peace-attack-lock-probe.lua");
  expect(probe.ok, probe.error).toBe(true);
  expect(restoredBattle.host.messages).toContain("messenger of peace attack true/false");
}

function attackLockProbeScript(lowAttackerCode: string, highAttackerCode: string): string {
  return `
    local low=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowAttackerCode}),0,0,LOCATION_MZONE,nil)
    local high=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highAttackerCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message("messenger of peace attack " .. tostring(low and low:CanAttack()) .. "/" .. tostring(high and high:CanAttack()))
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
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
