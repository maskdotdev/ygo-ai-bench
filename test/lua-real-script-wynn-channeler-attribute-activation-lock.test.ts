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
const attributeFire = 0x10;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wynn Channeler attribute activation lock", () => {
  it("restores its non-WIND monster effect activation lock after the hand search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wynnCode = "86395581";
    const discardCode = "86395582";
    const searchCode = "86395583";
    const fireResponderCode = "86395584";
    const windResponderCode = "86395585";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wynnCode),
      { code: discardCode, name: "Wynn Channeler WIND Discard", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000, attribute: attributeWind },
      { code: searchCode, name: "Wynn Channeler Search Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1500, attribute: attributeWind },
      { code: fireResponderCode, name: "Wynn Channeler FIRE Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeFire },
      { code: windResponderCode, name: "Wynn Channeler WIND Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000, attribute: attributeWind },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 863, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wynnCode, discardCode, searchCode, fireResponderCode, windResponderCode] }, 1: { main: [] } });
    startDuel(session);

    const wynn = requireCard(session, wynnCode);
    const discard = requireCard(session, discardCode);
    const search = requireCard(session, searchCode);
    const fireResponder = requireCard(session, fireResponderCode);
    const windResponder = requireCard(session, windResponderCode);
    for (const card of [wynn, discard, fireResponder, windResponder]) moveDuelCard(session.state, card.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${fireResponderCode}.lua`) return responderScript();
        if (name === `c${windResponderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wynnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(windResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(3);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === wynn.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === wynn.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === wynn.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:monster-attribute-except:8",
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === fireResponder.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === windResponder.uid)).toBe(true);
  });
});

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("wynn channeler responder resolved") end)
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
