import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const effectChangeDamage = 82;
const effectNoEffectDamage = 335;
const resetPhaseEnd = 0x40000200;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber Kirin effect damage prevention", () => {
  it("restores its self-tribute ignition into effect-damage prevention", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cyberKirinCode = "76986005";
    const fireCode = "46918794";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cyberKirinCode || card.code === fireCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7698, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cyberKirinCode] }, 1: { main: [fireCode] } });
    startDuel(session);

    const cyberKirin = session.state.cards.find((card) => card.code === cyberKirinCode);
    const fire = session.state.cards.find((card) => card.code === fireCode);
    expect(cyberKirin).toBeDefined();
    expect(fire).toBeDefined();
    moveDuelCard(session.state, cyberKirin!.uid, "monsterZone", 0);
    cyberKirin!.position = "faceUpAttack";
    cyberKirin!.faceUp = true;
    moveDuelCard(session.state, fire!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: (name: string) => workspace.readScript(name) };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cyberKirinCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    const kirinActivation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === cyberKirin!.uid);
    expect(kirinActivation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, kirinActivation!);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === cyberKirin!.uid)).toMatchObject({ location: "graveyard", previousLocation: "monsterZone" });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: cyberKirin!.uid, code: effectChangeDamage, targetRange: [1, 0], reset: { flags: resetPhaseEnd } }),
        expect.objectContaining({ sourceUid: cyberKirin!.uid, code: effectNoEffectDamage, targetRange: [1, 0], reset: { flags: resetPhaseEnd } }),
      ]),
    );

    const restoredEffects = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEffects.restoreComplete, restoredEffects.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredEffects, restoredEffects.session.state.waitingFor ?? restoredEffects.session.state.turnPlayer);
    expect(restoredEffects.missingRegistryKeys).toEqual([]);
    expect(restoredEffects.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: cyberKirin!.uid, code: effectChangeDamage, luaValueDescriptor: "change-damage:effect-zero", targetRange: [1, 0] }),
        expect.objectContaining({ sourceUid: cyberKirin!.uid, code: effectNoEffectDamage, targetRange: [1, 0] }),
      ]),
    );
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
    resolveRestoredChain(restoredFire);
    expect(restoredFire.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredFire.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredFire.session.state.eventHistory).not.toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "damageDealt", eventPlayer: 0 })]));
    expect(restoredFire.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "damageDealt", eventPlayer: 1, eventValue: 500 })]));
  });
});

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
