import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeXyz = 0x800000;
const typeEffect = 0x20;
const typeNormal = 0x10;
const setGunkan = 0x168;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gunkan Suship Catch-of-the-Day SelectCardsFromCodes", () => {
  it("restores the opponent code-selection prompt into the chosen Suship search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const catchCode = "83008724";
    const shariCode = "24639891";
    const sushipIkuraCode = "61027400";
    const sushipUniCode = "42377643";
    const sushipShirauoCode = "78362751";
    const extraSushipCode = "83008725";
    const responderCode = "83008726";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === catchCode),
      gunkanNormal(shariCode, "Gunkan Suship Shari"),
      gunkanMonster(sushipIkuraCode, "Gunkan Suship Ikura"),
      gunkanMonster(sushipUniCode, "Gunkan Suship Uni"),
      gunkanMonster(sushipShirauoCode, "Gunkan Suship Shirauo"),
      gunkanXyz(extraSushipCode, "Gunkan Suship Extra Deck Witness"),
      { code: responderCode, name: "Gunkan Suship Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 830, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [catchCode, shariCode, sushipIkuraCode, sushipUniCode, sushipShirauoCode], extra: [extraSushipCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const catchCard = requireCard(session, catchCode);
    const shari = requireCard(session, shariCode);
    const ikura = requireCard(session, sushipIkuraCode);
    const extraSuship = requireCard(session, extraSushipCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, catchCard.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, shari.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.cards.find((card) => card.uid === catchCard.uid)!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(catchCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === catchCard.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: catchCard.uid,
      operationInfos: [
        expect.objectContaining({ category: 0x800000, player: 0, parameter: 0x20d }),
      ],
      possibleOperationInfos: [
        expect.objectContaining({ category: 0x8, player: 0, parameter: 1 }),
        expect.objectContaining({ category: 0x10, player: 0, targetUids: [catchCard.uid] }),
      ],
    });
    expect(session.state.cards.find((card) => card.uid === shari.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === ikura.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === extraSuship.uid)).toMatchObject({ location: "extraDeck", controller: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectCardsFromCodes",
        player: 1,
        options: [Number(sushipIkuraCode), Number(sushipUniCode), Number(sushipShirauoCode)],
        descriptions: [Number(sushipIkuraCode), Number(sushipUniCode), Number(sushipShirauoCode)],
        returned: Number(sushipIkuraCode),
      }),
    ]));
    expect(restored.session.state.cards.find((card) => card.uid === ikura.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === catchCard.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === catchCard.uid)?.counters?.[0x20d]).toBe(1);
    expect(restored.host.messages).not.toContain("gunkan suship responder resolved");
  });
});

function gunkanNormal(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 2000, defense: 0, setcodes: [setGunkan] };
}

function gunkanMonster(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, setcodes: [setGunkan] };
}

function gunkanXyz(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeXyz | typeEffect, level: 4, attack: 2200, defense: 300, setcodes: [setGunkan] };
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
      e:SetOperation(function(e,tp) Debug.Message("gunkan suship responder resolved") end)
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
