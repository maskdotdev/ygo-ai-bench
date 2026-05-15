import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceZombie = 0x10;
const effectChangeDamage = 82;
const effectNoEffectDamage = 335;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shiranui Style Samsara damage prevention", () => {
  it("restores its face-up Trap quick effect damage lock after banish cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const samsaraCode = "78765160";
    const fireCode = "46918794";
    const zombieCode = "787601";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === samsaraCode || card.code === fireCode),
      { code: zombieCode, name: "Samsara Zombie Cost", kind: "monster", typeFlags: typeMonster, race: raceZombie, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7876, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [samsaraCode, zombieCode] }, 1: { main: [fireCode] } });
    startDuel(session);

    const samsara = session.state.cards.find((card) => card.code === samsaraCode);
    const fire = session.state.cards.find((card) => card.code === fireCode);
    const zombie = session.state.cards.find((card) => card.code === zombieCode);
    expect(samsara).toBeDefined();
    expect(fire).toBeDefined();
    expect(zombie).toBeDefined();
    moveDuelCard(session.state, samsara!.uid, "spellTrapZone", 0);
    samsara!.position = "faceDown";
    samsara!.faceUp = false;
    moveDuelCard(session.state, zombie!.uid, "monsterZone", 0);
    zombie!.position = "faceUpAttack";
    zombie!.faceUp = true;
    moveDuelCard(session.state, fire!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: (name: string) => workspace.readScript(name) };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(samsaraCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const trapActivation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === samsara!.uid);
    expect(trapActivation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, trapActivation!);

    const restoredTrapChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredTrapChain.restoreComplete, restoredTrapChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrapChain.missingRegistryKeys).toEqual([]);
    expect(restoredTrapChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrapChain, restoredTrapChain.session.state.waitingFor ?? restoredTrapChain.session.state.turnPlayer);
    resolveRestoredChain(restoredTrapChain);
    expect(restoredTrapChain.session.state.cards.find((card) => card.uid === samsara!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredTrapChain.session), source, reader);
    expect(restoredQuick.restoreComplete, restoredQuick.incompleteReasons.join("; ")).toBe(true);
    expect(restoredQuick.missingRegistryKeys).toEqual([]);
    expect(restoredQuick.missingChainLimitRegistryKeys).toEqual([]);
    restoredQuick.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredQuick, 0);
    const damageLock = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === samsara!.uid);
    expect(damageLock, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredQuick, damageLock!);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === zombie!.uid)).toMatchObject({ location: "banished", previousLocation: "monsterZone" });

    const restoredDamageLockChain = restoreDuelWithLuaScripts(serializeDuel(restoredQuick.session), source, reader);
    expect(restoredDamageLockChain.restoreComplete, restoredDamageLockChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageLockChain.missingRegistryKeys).toEqual([]);
    expect(restoredDamageLockChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDamageLockChain, restoredDamageLockChain.session.state.waitingFor ?? restoredDamageLockChain.session.state.turnPlayer);
    resolveRestoredChain(restoredDamageLockChain);
    expect(restoredDamageLockChain.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: samsara!.uid, code: effectChangeDamage, value: 0, targetRange: [1, 0] }),
        expect.objectContaining({ sourceUid: samsara!.uid, code: effectNoEffectDamage, value: 0, targetRange: [1, 0] }),
      ]),
    );

    const restoredEffects = restoreDuelWithLuaScripts(serializeDuel(restoredDamageLockChain.session), source, reader);
    expect(restoredEffects.restoreComplete, restoredEffects.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredFire.missingRegistryKeys).toEqual([]);
    expect(restoredFire.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredFire, restoredFire.session.state.waitingFor ?? restoredFire.session.state.turnPlayer);
    resolveRestoredChain(restoredFire);
    expect(restoredFire.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredFire.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredFire.session.state.eventHistory).not.toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "damageDealt", eventPlayer: 0 })]));
    expect(restoredFire.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "damageDealt", eventPlayer: 1, eventValue: 500 })]));
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
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
