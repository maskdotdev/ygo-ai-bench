import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shinobird Crow Damage Step stat boost", () => {
  it("restores its Damage Step discard label object and applies the ATK/DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const crowCode = "39817919";
    const costSpiritCode = "39817920";
    const defenderCode = "39817921";
    const responderCode = "39817922";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crowCode),
      { code: costSpiritCode, name: "Shinobird Crow Discarded Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 700, defense: 900 },
      { code: defenderCode, name: "Shinobird Crow Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 500, defense: 500 },
      { code: responderCode, name: "Shinobird Crow Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 398, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crowCode, costSpiritCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const crow = session.state.cards.find((card) => card.code === crowCode);
    const costSpirit = session.state.cards.find((card) => card.code === costSpiritCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(crow).toBeDefined();
    expect(costSpirit).toBeDefined();
    expect(defender).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, crow!.uid, "monsterZone", 0);
    crow!.position = "faceUpAttack";
    crow!.faceUp = true;
    moveDuelCard(session.state, costSpirit!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(crowCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === crow!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passRestoredBattleAction(restoredSetup, 1, "passAttack");
    passRestoredBattleAction(restoredSetup, 0, "passAttack");
    expect(restoredSetup.session.state.battleWindow?.kind).toBe("startDamageStep");

    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expect(restoredDamageStep.restoreComplete, restoredDamageStep.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageStep.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDamageStep, 1);
    passRestoredBattleAction(restoredDamageStep, 1, "passDamage");
    expect(restoredDamageStep.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restoredDamageStep.session.state.waitingFor).toBe(0);

    const activation = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === crow!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageStep, activation!);
    expect(restoredDamageStep.session.state.cards.find((card) => card.uid === costSpirit!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restoredDamageStep.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "discarded", eventCode: 1018, eventCardUid: costSpirit!.uid }),
        expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: costSpirit!.uid }),
      ]),
    );
    expect(restoredDamageStep.session.state.chain).toHaveLength(1);
    expect(restoredDamageStep.session.state.chain[0]).toMatchObject({
      sourceUid: crow!.uid,
      effectLabelObjectUid: costSpirit!.uid,
    });
    expect(getLuaRestoreLegalActions(restoredDamageStep, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredDamageStep.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    const passChain = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(passChain, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, passChain!);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    const restoredCrow = restoredChain.session.state.cards.find((card) => card.uid === crow!.uid);
    expect(restoredCrow).toBeDefined();
    expect(currentAttack(restoredCrow, restoredChain.session.state)).toBe(700);
    expect(currentDefense(restoredCrow, restoredChain.session.state)).toBe(900);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattle, 1);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === crow!.uid), restoredBattle.session.state)).toBe(700);
    passBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(200);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === crow!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.host.messages).not.toContain("shinobird crow responder resolved");
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
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("shinobird crow responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
