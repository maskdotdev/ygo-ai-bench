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
const attributeWater = 0x2;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Eria Channeler attribute activation lock", () => {
  it("restores its non-WATER monster effect activation lock after the hand search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const eriaCode = "15746348";
    const discardCode = "15746349";
    const searchCode = "15746350";
    const fireResponderCode = "15746351";
    const waterResponderCode = "15746352";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === eriaCode),
      { code: discardCode, name: "Eria Channeler WATER Discard", kind: "monster", typeFlags: 0x21, level: 3, attack: 1000, defense: 1000, attribute: attributeWater },
      { code: searchCode, name: "Eria Channeler Search Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000, attribute: attributeWater },
      { code: fireResponderCode, name: "Eria Channeler FIRE Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeFire },
      { code: waterResponderCode, name: "Eria Channeler WATER Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeWater },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 157, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [eriaCode, discardCode, searchCode, fireResponderCode, waterResponderCode] }, 1: { main: [] } });
    startDuel(session);

    const eria = requireCard(session, eriaCode);
    const discard = requireCard(session, discardCode);
    const search = requireCard(session, searchCode);
    const fireResponder = requireCard(session, fireResponderCode);
    const waterResponder = requireCard(session, waterResponderCode);
    for (const card of [eria, discard, fireResponder, waterResponder]) moveDuelCard(session.state, card.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${fireResponderCode}.lua`) return responderScript();
        if (name === `c${waterResponderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(eriaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(waterResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === eria.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.cards.find((card) => card.uid === eria.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === eria.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:monster-attribute-except:2",
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === fireResponder.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === waterResponder.uid)).toBe(true);
  });
});

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("eria channeler responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
