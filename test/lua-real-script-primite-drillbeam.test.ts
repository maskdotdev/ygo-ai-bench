import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Drillbeam", () => {
  it("restores its target banish and graveyard Set effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const drillbeamCode = "29095457";
    const etherBerylCode = "63198739";
    const darkMagicianCode = "46986414";
    const targetCode = "29090000";
    const responderCode = "29090001";
    const realCards = workspace.readDatabaseCards("cards.cdb").filter((card) => [drillbeamCode, etherBerylCode, darkMagicianCode].includes(card.code));
    const cards: DuelCardData[] = [
      ...realCards,
      { code: targetCode, name: "Drillbeam Negatable Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Drillbeam Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 290, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [drillbeamCode, etherBerylCode, darkMagicianCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const drillbeam = session.state.cards.find((card) => card.code === drillbeamCode);
    const etherBeryl = session.state.cards.find((card) => card.code === etherBerylCode);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(drillbeam).toBeDefined();
    expect(etherBeryl).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, drillbeam!.uid, "hand", 0);
    moveDuelCard(session.state, darkMagician!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    moveDuelCard(session.state, responder!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${targetCode}.lua`) return negatableTargetScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(drillbeamCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targetCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === drillbeam!.uid);
    expect(activate).toBeDefined();
    const activated = applyResponse(session, activate!);
    expect(activated.ok, activated.error).toBe(true);
    expect(session.state.chain[0]?.operationInfos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 0x4000, targetUids: [target!.uid] }),
        expect.objectContaining({ category: 0x4, targetUids: [target!.uid] }),
      ]),
    );

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 1)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 1));
    resolveOpenChain(restoredActivation.session);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", faceUp: true });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === drillbeam!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredActivation.host.messages).not.toContain("drillbeam target resolved");
    expect(restoredActivation.host.messages).not.toContain("drillbeam responder resolved");
    moveDuelCard(restoredActivation.session.state, etherBeryl!.uid, "monsterZone", 0).position = "faceUpAttack";

    const setFromGrave = getLegalActions(restoredActivation.session, 0).find((action) => action.type === "activateEffect" && action.uid === drillbeam!.uid);
    expect(setFromGrave).toBeDefined();
    const setActivated = applyResponse(restoredActivation.session, setFromGrave!);
    expect(setActivated.ok, setActivated.error).toBe(true);
    const restoredSet = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredSet.restoreComplete, restoredSet.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSet.missingRegistryKeys).toEqual([]);
    expect(restoredSet.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSet, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSet, 0));
    resolveOpenChain(restoredSet.session);
    expect(restoredSet.session.state.cards.find((card) => card.uid === drillbeam!.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
    });
  });
});

function resolveOpenChain(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.chain.length > 0; index += 1) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyResponse(session, pass!);
    expect(result.ok, result.error).toBe(true);
  }
  expect(session.state.chain).toHaveLength(0);
}

function negatableTargetScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Debug.Message("drillbeam target resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("drillbeam responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
