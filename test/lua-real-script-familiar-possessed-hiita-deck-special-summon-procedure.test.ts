import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Familiar-Possessed - Hiita Deck Special Summon procedure", () => {
  it("restores its Deck summon procedure material selection, cost send, deck shuffle, and piercing grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hiitaCode = "4376658";
    const charmerCode = "759393";
    const fireMaterialCode = "4376659";
    const deckFillerACode = "4376660";
    const deckFillerBCode = "4376661";
    const script = workspace.readScript(`official/c${hiitaCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_DECK)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,0)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("Duel.ShuffleDeck(tp)");
    expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hiitaCode),
      monster(charmerCode, "Hiita the Fire Charmer Material"),
      { ...monster(fireMaterialCode, "Familiar-Possessed Hiita FIRE Material"), attribute: attributeFire },
      monster(deckFillerACode, "Familiar-Possessed Hiita Deck Filler A"),
      monster(deckFillerBCode, "Familiar-Possessed Hiita Deck Filler B"),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 437, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hiitaCode, charmerCode, fireMaterialCode, deckFillerACode, deckFillerBCode] }, 1: { main: [] } });
    startDuel(session);

    const hiita = session.state.cards.find((card) => card.code === hiitaCode);
    const charmer = session.state.cards.find((card) => card.code === charmerCode);
    const fireMaterial = session.state.cards.find((card) => card.code === fireMaterialCode);
    expect(hiita).toBeDefined();
    expect(charmer).toBeDefined();
    expect(fireMaterial).toBeDefined();
    moveDuelCard(session.state, charmer!.uid, "monsterZone", 0);
    charmer!.faceUp = true;
    charmer!.position = "faceUpAttack";
    moveDuelCard(session.state, fireMaterial!.uid, "monsterZone", 0);
    fireMaterial!.faceUp = true;
    fireMaterial!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hiitaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === hiita!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === hiita!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === charmer!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fireMaterial!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === hiita!.uid && effect.code === 203)).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 203,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-203",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "deck",
            "hand",
            "monsterZone",
            "spellTrapZone",
            "graveyard",
            "banished",
            "extraDeck",
            "overlay",
          ],
          "registryKey": "lua:4376658:lua-2-203",
          "reset": {
            "flags": 16715776,
          },
          "sourceUid": "p0-deck-4376658-0",
          "target": [Function],
        },
      ]
    `);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard")).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: charmer!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: hiita!.uid,
        eventReasonEffectId: 1,
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
          sequence: 0,
        },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: fireMaterial!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: hiita!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: charmer!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: hiita!.uid,
        eventReasonEffectId: 1,
        eventUids: [charmer!.uid, fireMaterial!.uid],
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
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: hiita!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function monster(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
