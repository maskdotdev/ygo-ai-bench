import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const attributeFire = 0x4;
const attributeLight = 0x10;
const raceFairy = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shopina LIGHT activation lock", () => {
  it("restores its cost-registered non-LIGHT monster effect activation lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shopinaCode = "5908650";
    const targetCode = "5908651";
    const fireResponderCode = "5908652";
    const lightResponderCode = "5908653";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shopinaCode),
      { code: targetCode, name: "Shopina LIGHT Fairy Target", kind: "monster", typeFlags: 0x21, race: raceFairy, level: 4, attack: 1200, defense: 1000, attribute: attributeLight },
      { code: fireResponderCode, name: "Shopina FIRE Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeFire },
      { code: lightResponderCode, name: "Shopina LIGHT Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeLight },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 590, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shopinaCode, targetCode, fireResponderCode, lightResponderCode] }, 1: { main: [] } });
    startDuel(session);

    const shopina = requireCard(session, shopinaCode);
    const target = requireCard(session, targetCode);
    const fireResponder = requireCard(session, fireResponderCode);
    const lightResponder = requireCard(session, lightResponderCode);
    moveDuelCard(session.state, shopina.uid, "monsterZone", 0);
    moveDuelCard(session.state, target.uid, "graveyard", 0);
    for (const card of [fireResponder, lightResponder]) moveDuelCard(session.state, card.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${fireResponderCode}.lua`) return responderScript();
        if (name === `c${lightResponderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shopinaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(lightResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === shopina.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.cards.find((card) => card.uid === shopina.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === shopina.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:monster-attribute-except:16",
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredLock, 0)).toEqual(getGroupedDuelLegalActions(restoredLock.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredLock, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredLock, 0),
    );
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === fireResponder.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === lightResponder.uid)).toBe(true);
  });
});

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("shopina responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
