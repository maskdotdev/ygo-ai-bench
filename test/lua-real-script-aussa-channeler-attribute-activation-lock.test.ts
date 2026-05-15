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
const attributeEarth = 0x1;
const attributeFire = 0x4;
const raceSpellcaster = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Aussa Channeler attribute activation lock", () => {
  it("restores its non-EARTH monster effect activation lock after the race-gated hand search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const aussaCode = "62803464";
    const discardCode = "62803465";
    const searchCode = "62803466";
    const fireResponderCode = "62803467";
    const earthResponderCode = "62803468";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === aussaCode),
      { code: discardCode, name: "Aussa Channeler EARTH Discard", kind: "monster", typeFlags: 0x21, race: raceSpellcaster, level: 4, attack: 1000, defense: 1000, attribute: attributeEarth },
      { code: searchCode, name: "Aussa Channeler Search Target", kind: "monster", typeFlags: 0x21, race: raceSpellcaster, level: 4, attack: 1800, defense: 1000, attribute: attributeEarth },
      { code: fireResponderCode, name: "Aussa Channeler FIRE Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeFire },
      { code: earthResponderCode, name: "Aussa Channeler EARTH Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeEarth },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 628, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [aussaCode, discardCode, searchCode, fireResponderCode, earthResponderCode] }, 1: { main: [] } });
    startDuel(session);

    const aussa = requireCard(session, aussaCode);
    const discard = requireCard(session, discardCode);
    const search = requireCard(session, searchCode);
    const fireResponder = requireCard(session, fireResponderCode);
    const earthResponder = requireCard(session, earthResponderCode);
    for (const card of [aussa, discard, fireResponder, earthResponder]) moveDuelCard(session.state, card.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${fireResponderCode}.lua`) return responderScript();
        if (name === `c${earthResponderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(aussaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(earthResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === aussa.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === aussa.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === aussa.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:monster-attribute-except:1",
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredLock, 0)).toEqual(getGroupedDuelLegalActions(restoredLock.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredLock, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredLock, 0));
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === fireResponder.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === earthResponder.uid)).toBe(true);
  });
});

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("aussa channeler responder resolved") end)
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
