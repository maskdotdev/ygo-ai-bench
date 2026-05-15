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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dimension Sphinx persistent battle damage", () => {
  it("restores official persistent target into Battle Step damage activation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dimensionSphinxCode = "17787975";
    const targetCode = "613901";
    const attackerCode = "613902";
    const responderCode = "613903";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dimensionSphinxCode),
      { code: targetCode, name: "Dimension Sphinx Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Dimension Sphinx Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Dimension Sphinx Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 321, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dimensionSphinxCode, targetCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const dimensionSphinx = session.state.cards.find((card) => card.code === dimensionSphinxCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(dimensionSphinx).toBeDefined();
    expect(target).toBeDefined();
    expect(attacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, dimensionSphinx!.uid, "spellTrapZone", 0);
    dimensionSphinx!.position = "faceDown";
    dimensionSphinx!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
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
    expect(host.loadCardScript(Number(dimensionSphinxCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === dimensionSphinx!.uid);
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
        "sourceUid": "p0-deck-17787975-0",
        "targetUids": [
          "p0-deck-613901-1",
        ],
      }
    `);

    const restoredPersistentChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredPersistentChain);
    expectRestoredLegalActions(restoredPersistentChain, 1);
    resolveRestoredChain(restoredPersistentChain);

    expect(restoredPersistentChain.session.state.cards.find((card) => card.uid === dimensionSphinx!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredPersistentChain.host.messages).not.toContain("dimension sphinx responder resolved");

    const persistentSnapshot = serializeDuel(restoredPersistentChain.session);
    const restoredPersistent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, restoredPersistent.session.state.waitingFor ?? restoredPersistent.session.state.turnPlayer);
    expectDimensionSphinxProbe(restoredPersistent, dimensionSphinxCode, targetCode, "dimension sphinx persistent true/true/1/0");

    restoredPersistent.session.state.turnPlayer = 1;
    restoredPersistent.session.state.phase = "battle";
    restoredPersistent.session.state.waitingFor = 1;
    const attack = getLuaRestoreLegalActions(restoredPersistent, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, attack!);
    if (restoredPersistent.session.state.waitingFor === 1) {
      const attackerPass = getLuaRestoreLegalActions(restoredPersistent, 1).find((action) => action.type === "passAttack");
      expect(attackerPass, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 1), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredPersistent, attackerPass!);
    }

    const restoredBattleWindow = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
    expectCleanRestore(restoredBattleWindow);
    expectRestoredLegalActions(restoredBattleWindow, 0);
    const sphinxDamage = getLuaRestoreLegalActions(restoredBattleWindow, 0).find((action) => action.type === "activateEffect" && action.uid === dimensionSphinx!.uid);
    expect(sphinxDamage, JSON.stringify(getLuaRestoreLegalActions(restoredBattleWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleWindow, sphinxDamage!);
    expect(restoredBattleWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-3-1002",
        "id": "chain-6",
        "operationInfos": [
          {
            "category": 524288,
            "count": 0,
            "parameter": 800,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-17787975-0",
        "targetParam": 800,
        "targetPlayer": 1,
      }
    `);
    expectDimensionSphinxProbe(restoredBattleWindow, dimensionSphinxCode, targetCode, "dimension sphinx persistent true/true/1/1");
    expect(getLuaRestoreLegalActions(restoredBattleWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredBattleWindow.session), source, reader);
    expectCleanRestore(restoredDamageChain);
    expectRestoredLegalActions(restoredDamageChain, restoredDamageChain.session.state.waitingFor ?? restoredDamageChain.session.state.turnPlayer);
    resolveRestoredChain(restoredDamageChain);
    expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredDamageChain.host.messages).not.toContain("dimension sphinx responder resolved");

    passBattleResponses(restoredDamageChain);
    expect(restoredDamageChain.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredDamageChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredDamageChain.session.state.cards.find((card) => card.uid === dimensionSphinx!.uid)).toMatchObject({
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("dimension sphinx responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectDimensionSphinxProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, dimensionSphinxCode: string, targetCode: string, message: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dimensionSphinxCode}),0,LOCATION_SZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message(
        "dimension sphinx persistent " ..
        tostring(trap:IsHasCardTarget(target)) .. "/" ..
        tostring(aux.PersistentTargetFilter(e,target)) .. "/" ..
        trap:GetCardTargetCount() .. "/" ..
        trap:GetFlagEffect(${dimensionSphinxCode})
      )
    `,
    "dimension-sphinx-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(message);
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
