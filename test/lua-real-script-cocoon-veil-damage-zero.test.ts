import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const setChrysalis = 0x1e;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cocoon Veil damage prevention", () => {
  it("restores its release-cost damage lock and selected Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cocoonVeilCode = "56641453";
    const chrysalisCode = "566401";
    const summonCode = "566402";
    const fireCode = "46918794";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cocoonVeilCode || card.code === fireCode),
      { code: chrysalisCode, name: "Cocoon Veil Chrysalis Cost", kind: "monster", typeFlags: typeMonster, setcodes: [setChrysalis], listedNames: [summonCode], level: 4, attack: 800, defense: 1200 },
      { code: summonCode, name: "Cocoon Veil Listed Summon", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5664, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cocoonVeilCode, chrysalisCode, summonCode] }, 1: { main: [fireCode] } });
    startDuel(session);

    const cocoonVeil = session.state.cards.find((card) => card.code === cocoonVeilCode);
    const chrysalis = session.state.cards.find((card) => card.code === chrysalisCode);
    const summon = session.state.cards.find((card) => card.code === summonCode);
    const fire = session.state.cards.find((card) => card.code === fireCode);
    expect(cocoonVeil).toBeDefined();
    expect(chrysalis).toBeDefined();
    expect(summon).toBeDefined();
    expect(fire).toBeDefined();
    moveDuelCard(session.state, cocoonVeil!.uid, "spellTrapZone", 0);
    cocoonVeil!.position = "faceDown";
    cocoonVeil!.faceUp = false;
    moveDuelCard(session.state, chrysalis!.uid, "monsterZone", 0);
    chrysalis!.position = "faceUpAttack";
    chrysalis!.faceUp = true;
    moveDuelCard(session.state, summon!.uid, "deck", 0);
    moveDuelCard(session.state, fire!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: (name: string) => workspace.readScript(name) };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cocoonVeilCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === cocoonVeil!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === chrysalis!.uid)).toMatchObject({ location: "graveyard", previousLocation: "monsterZone" });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === summon!.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === cocoonVeil!.uid && [82, 335].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "code": 82,
          "controller": 0,
          "event": "continuous",
          "id": "lua-3-82",
          "lifePointValue": [Function],
          "luaValueDescriptor": "change-damage:effect-zero",
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
          "property": 2048,
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
          "registryKey": "lua:56641453:lua-3-82",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-56641453-0",
          "targetRange": [
            1,
            0,
          ],
        },
        {
          "battleDamageValue": [Function],
          "code": 335,
          "controller": 0,
          "event": "continuous",
          "id": "lua-4-335",
          "lifePointValue": [Function],
          "luaValueDescriptor": "change-damage:effect-zero",
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
          "property": 2048,
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
          "registryKey": "lua:56641453:lua-4-335",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-56641453-0",
          "targetRange": [
            1,
            0,
          ],
        },
      ]
    `);

    const restoredEffects = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEffects.restoreComplete, restoredEffects.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredEffects, restoredEffects.session.state.waitingFor ?? restoredEffects.session.state.turnPlayer);
    expect(restoredEffects.missingRegistryKeys).toEqual([]);
    expect(restoredEffects.missingChainLimitRegistryKeys).toEqual([]);
    restoredEffects.session.state.turnPlayer = 1;
    restoredEffects.session.state.phase = "main1";
    restoredEffects.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredEffects, 1);
    const fireActivation = getLuaRestoreLegalActions(restoredEffects, 1).find((action) => action.type === "activateEffect" && action.uid === fire!.uid);
    expect(fireActivation, JSON.stringify(getLuaRestoreLegalActions(restoredEffects, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEffects, fireActivation!);

    const restoredFire = restoreDuelWithLuaScripts(serializeDuel(restoredEffects.session), source, reader);
    expect(restoredFire.restoreComplete, restoredFire.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredFire, restoredFire.session.state.waitingFor ?? restoredFire.session.state.turnPlayer);
    expect(restoredFire.missingRegistryKeys).toEqual([]);
    expect(restoredFire.missingChainLimitRegistryKeys).toEqual([]);
    resolveRestoredChain(restoredFire);
    expect(restoredFire.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredFire.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt" && event.eventPlayer === 0)).toEqual([]);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: fire!.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
    expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
