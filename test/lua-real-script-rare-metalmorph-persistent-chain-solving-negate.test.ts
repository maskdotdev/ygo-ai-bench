import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rare Metalmorph persistent chain-solving negate", () => {
  it("restores official persistent target boost and targeted Spell negation watcher", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rareMetalmorphCode = "12503902";
    const bookOfMoonCode = "14087893";
    const targetCode = "613701";
    const responderCode = "613702";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rareMetalmorphCode || card.code === bookOfMoonCode),
      { code: targetCode, name: "Rare Metalmorph Machine Target", kind: "monster", typeFlags: 0x21, race: 0x20, level: 4, attack: 2000, defense: 1600 },
      { code: responderCode, name: "Rare Metalmorph Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 319, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rareMetalmorphCode, bookOfMoonCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const rareMetalmorph = session.state.cards.find((card) => card.code === rareMetalmorphCode);
    const bookOfMoon = session.state.cards.find((card) => card.code === bookOfMoonCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(rareMetalmorph).toBeDefined();
    expect(bookOfMoon).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, rareMetalmorph!.uid, "spellTrapZone", 0);
    rareMetalmorph!.position = "faceDown";
    rareMetalmorph!.faceUp = false;
    moveDuelCard(session.state, bookOfMoon!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
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
    expect(host.loadCardScript(Number(rareMetalmorphCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(bookOfMoonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === rareMetalmorph!.uid);
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
        "sourceUid": "p0-deck-12503902-0",
        "targetUids": [
          "p0-deck-613701-2",
        ],
      }
    `);
    expect(restoredActivation.session.state.chain[0]?.operationInfos ?? []).toEqual([]);

    const restoredRareChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredRareChain.restoreComplete, restoredRareChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredRareChain.missingRegistryKeys).toEqual([]);
    expect(restoredRareChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredRareChain, 1)).toEqual(getGroupedDuelLegalActions(restoredRareChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredRareChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredRareChain, 1));
    resolveRestoredChain(restoredRareChain);

    expect(restoredRareChain.session.state.cards.find((card) => card.uid === rareMetalmorph!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });

    const persistentSnapshot = serializeDuel(restoredRareChain.session);
    const restoredPersistent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredPersistent.restoreComplete, restoredPersistent.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPersistent.missingRegistryKeys).toEqual([]);
    expect(restoredPersistent.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPersistent, 0);
    const persistentProbe = restoredPersistent.host.loadScript(
      persistentRareMetalmorphProbeScript(rareMetalmorphCode, targetCode),
      "rare-metalmorph-persistent-probe.lua",
    );
    expect(persistentProbe.ok, persistentProbe.error).toBe(true);
    expect(restoredPersistent.host.messages).toContain("rare metalmorph persistent true/true/1/2500");

    const bookActivation = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "activateEffect" && action.uid === bookOfMoon!.uid);
    expect(bookActivation, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, bookActivation!);
    expect(restoredPersistent.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-5-1002",
        "id": "chain-5",
        "operationInfos": [
          {
            "category": 4096,
            "count": 1,
            "parameter": 8,
            "player": 0,
            "targetUids": [
              "p0-deck-613701-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-14087893-1",
        "targetUids": [
          "p0-deck-613701-2",
        ],
      }
    `);
    expect(getLuaRestoreLegalActions(restoredPersistent, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredBookChain = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
    expect(restoredBookChain.restoreComplete, restoredBookChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBookChain.missingRegistryKeys).toEqual([]);
    expect(restoredBookChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBookChain, 1);
    resolveRestoredChain(restoredBookChain);
    expect(restoredBookChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
    });
    expect(restoredBookChain.session.state.cards.find((card) => card.uid === bookOfMoon!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBookChain.host.messages).not.toContain("rare metalmorph responder resolved");

    const restoredTargetSent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredTargetSent.restoreComplete, restoredTargetSent.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTargetSent.missingRegistryKeys).toEqual([]);
    expect(restoredTargetSent.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTargetSent, 0);
    sendDuelCardToGraveyard(restoredTargetSent.session.state, target!.uid, 0, duelReason.effect, 0);
    expect(restoredTargetSent.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetSent.session.state.cards.find((card) => card.uid === rareMetalmorph!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
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
      e:SetOperation(function(e,tp) Debug.Message("rare metalmorph responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function persistentRareMetalmorphProbeScript(rareMetalmorphCode: string, targetCode: string): string {
  return `
    local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rareMetalmorphCode}),0,LOCATION_SZONE,0,nil)
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
    local persistent=Effect.CreateEffect(trap)
    Debug.Message(
      "rare metalmorph persistent " ..
      tostring(trap:IsHasCardTarget(target)) .. "/" ..
      tostring(aux.PersistentTargetFilter(persistent,target)) .. "/" ..
      trap:GetCardTargetCount() .. "/" ..
      target:GetAttack()
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
