import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeNormal = 0x10;
const raceSpellcaster = 0x2;
const raceDragon = 0x2000;
const effectChangeDamage = 82;
const effectNoEffectDamage = 335;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dragon Revival Rhapsody damage prevention", () => {
  it("restores its opponent damage lock after Graveyard Dragon summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rhapsodyCode = "71867500";
    const fireCode = "46918794";
    const spellcasterCode = "718601";
    const normalDragonCode = "718602";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rhapsodyCode || card.code === fireCode),
      { code: spellcasterCode, name: "Rhapsody Spellcaster", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, level: 4, attack: 1600, defense: 1200 },
      { code: normalDragonCode, name: "Rhapsody Normal Dragon", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceDragon, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7186, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rhapsodyCode, spellcasterCode, normalDragonCode] }, 1: { main: [fireCode] } });
    startDuel(session);

    const rhapsody = session.state.cards.find((card) => card.code === rhapsodyCode);
    const fire = session.state.cards.find((card) => card.code === fireCode);
    const spellcaster = session.state.cards.find((card) => card.code === spellcasterCode);
    const normalDragon = session.state.cards.find((card) => card.code === normalDragonCode);
    expect(rhapsody).toBeDefined();
    expect(fire).toBeDefined();
    expect(spellcaster).toBeDefined();
    expect(normalDragon).toBeDefined();
    moveDuelCard(session.state, rhapsody!.uid, "hand", 0);
    moveDuelCard(session.state, spellcaster!.uid, "monsterZone", 0);
    spellcaster!.position = "faceUpAttack";
    spellcaster!.faceUp = true;
    moveDuelCard(session.state, normalDragon!.uid, "graveyard", 0);
    moveDuelCard(session.state, fire!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: (name: string) => workspace.readScript(name) };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rhapsodyCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const rhapsodyAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === rhapsody!.uid);
    expect(rhapsodyAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, rhapsodyAction!);
    expect(session.state.cards.find((card) => card.uid === normalDragon!.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(session.state.cards.find((card) => card.uid === rhapsody!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.effects.filter((effect) => effect.sourceUid === rhapsody!.uid && [effectChangeDamage, effectNoEffectDamage].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 82,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-82",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
          "promptOperation": [Function],
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
          "registryKey": "lua:71867500:lua-3-82",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-71867500-0",
          "target": [Function],
          "targetRange": [
            0,
            1,
          ],
          "value": 0,
        },
        {
          "canActivate": [Function],
          "code": 335,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-335",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
          "promptOperation": [Function],
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
          "registryKey": "lua:71867500:lua-4-335",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-71867500-0",
          "target": [Function],
          "targetRange": [
            0,
            1,
          ],
          "value": 0,
        },
      ]
    `);

    const restoredEffects = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEffects.restoreComplete, restoredEffects.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredEffects, restoredEffects.session.state.waitingFor ?? restoredEffects.session.state.turnPlayer);
    expect(restoredEffects.missingRegistryKeys).toEqual([]);
    expect(restoredEffects.missingChainLimitRegistryKeys).toEqual([]);
    restoredEffects.session.state.turnPlayer = 1;
    restoredEffects.session.state.phase = "main1";
    restoredEffects.session.state.waitingFor = 1;
    const fireActivation = getLuaRestoreLegalActions(restoredEffects, 1).find((action) => action.type === "activateEffect" && action.uid === fire!.uid);
    expect(fireActivation, JSON.stringify(getLuaRestoreLegalActions(restoredEffects, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEffects, fireActivation!);

    const restoredFire = restoreDuelWithLuaScripts(serializeDuel(restoredEffects.session), source, reader);
    expect(restoredFire.restoreComplete, restoredFire.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredFire, restoredFire.session.state.waitingFor ?? restoredFire.session.state.turnPlayer);
    expect(restoredFire.missingRegistryKeys).toEqual([]);
    expect(restoredFire.missingChainLimitRegistryKeys).toEqual([]);
    resolveRestoredChain(restoredFire);
    expect(restoredFire.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredFire.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: fire!.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt" && event.eventPlayer === 1)).toEqual([]);
  });
});

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
