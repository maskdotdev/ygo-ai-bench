import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelResponse, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Premature Burial revive destroy", () => {
  it("restores Premature Burial's LP cost, equip target relation, and leave-field destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const prematureCode = "70828912";
    const targetCode = "612601";
    const responderCode = "612602";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === prematureCode),
      { code: targetCode, name: "Premature Burial Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1700, defense: 1200 },
      { code: responderCode, name: "Premature Burial Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [prematureCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const premature = session.state.cards.find((card) => card.code === prematureCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(premature).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, premature!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(prematureCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === premature!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredActivation.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 800,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: premature!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredActivation.session.state.chain).toHaveLength(1);
    expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-612601-1",
            ],
          },
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-70828912-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-70828912-0",
        "targetUids": [
          "p0-deck-612601-1",
        ],
      }
    `);
    expect(restoredActivation.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x40000, targetUids: [premature!.uid], count: 1, player: 0, parameter: 0 },
    ]);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.session.state.chain[0]).toEqual(restoredActivation.session.state.chain[0]!);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === premature!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("premature responder resolved");

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEquipped.restoreComplete, restoredEquipped.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipped.missingRegistryKeys).toEqual([]);
    expect(restoredEquipped.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipped, restoredEquipped.session.state.waitingFor ?? restoredEquipped.session.state.turnPlayer);
    expectLuaPrematureProbe(restoredEquipped, targetCode, prematureCode, "premature probe 0/612601/612601/1");

    destroyDuelCard(restoredEquipped.session.state, premature!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === premature!.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target!.uid,
    });
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: premature!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expect(restoredDestroyed.restoreComplete, restoredDestroyed.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDestroyed.missingRegistryKeys).toEqual([]);
    expect(restoredDestroyed.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDestroyed, restoredDestroyed.session.state.waitingFor ?? restoredDestroyed.session.state.turnPlayer);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === premature!.uid)).toMatchObject({ location: "graveyard" });
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
      e:SetOperation(function(e,tp) Debug.Message("premature responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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

function expectLuaPrematureProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, prematureCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${prematureCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local first=equip and equip:GetFirstCardTarget()
      local equipTarget=equip and equip:GetEquipTarget()
      Debug.Message("premature probe " .. target:GetControler() .. "/" .. tostring(equipTarget and equipTarget:GetCode()) .. "/" .. tostring(first and first:GetCode()) .. "/" .. equip:GetCardTargetCount())
    `,
    "premature-burial-revive-destroy-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
