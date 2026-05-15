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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Miniaturize persistent Damage Step stats", () => {
  it("restores official persistent target into Damage Step ATK and Level updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const miniaturizeCode = "34815282";
    const targetCode = "613911";
    const attackerCode = "613912";
    const responderCode = "613913";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === miniaturizeCode),
      { code: targetCode, name: "Miniaturize Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: attackerCode, name: "Miniaturize Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 900 },
      { code: responderCode, name: "Miniaturize Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 322, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [miniaturizeCode, targetCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const miniaturize = session.state.cards.find((card) => card.code === miniaturizeCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(miniaturize).toBeDefined();
    expect(target).toBeDefined();
    expect(attacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, miniaturize!.uid, "spellTrapZone", 0);
    miniaturize!.position = "faceDown";
    miniaturize!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(miniaturizeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      property: 0x4000,
      range: ["hand"],
    });

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSetup);
    expect(restoredSetup.session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      property: 0x4000,
      range: ["hand"],
    });
    expectRestoredLegalActions(restoredSetup, 1);
    const attack = getLuaRestoreLegalActions(restoredSetup, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSetup, attack!);
    passRestoredBattleAction(restoredSetup, 0, "passAttack");
    passRestoredBattleAction(restoredSetup, 1, "passAttack");
    expect(restoredSetup.session.state.battleWindow?.kind).toBe("startDamageStep");

    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 0);
    const activation = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === miniaturize!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDamageStep, activation!);
    expect(restoredDamageStep.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "player": 0,
        "sourceUid": "p0-deck-34815282-0",
        "targetUids": [
          "p0-deck-613911-1",
        ],
      }
    `);
    expect(getLuaRestoreLegalActions(restoredDamageStep, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredDamageStep.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === miniaturize!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("miniaturize responder resolved");
    expectMiniaturizeProbe(restoredChain, miniaturizeCode, targetCode, "miniaturize persistent true/true/1/800/3");

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, restoredBattle.session.state.waitingFor ?? restoredBattle.session.state.turnPlayer);
    passBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage[0]).toBe(100);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7900);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p1-deck-613912-0",
          "eventCode": 1143,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "battleDamageDealt",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 1,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 32,
          "eventReasonPlayer": 1,
          "eventValue": 100,
        },
      ]
    `);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === miniaturize!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
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
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("miniaturize responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectMiniaturizeProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, miniaturizeCode: string, targetCode: string, message: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${miniaturizeCode}),0,LOCATION_SZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message(
        "miniaturize persistent " ..
        tostring(trap:IsHasCardTarget(target)) .. "/" ..
        tostring(aux.PersistentTargetFilter(e,target)) .. "/" ..
        trap:GetCardTargetCount() .. "/" ..
        target:GetAttack() .. "/" ..
        target:GetLevel()
      )
    `,
    "miniaturize-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(message);
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
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
