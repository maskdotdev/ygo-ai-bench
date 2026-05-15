import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, canSpecialSummonDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { setDuelPlayerLifePoints } from "#duel/player-life.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script summon and set cost gates", () => {
  it("applies official Chain Energy summon and set costs to legal actions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const chainEnergyCode = "79323590";
    const chainEnergy = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === chainEnergyCode);
    expect(chainEnergy).toBeDefined();
    const customCards: DuelCardData[] = [
      chainEnergy!,
      { code: "90000001", name: "Normal Summon Cost Target", kind: "monster" },
      { code: "90000002", name: "Monster Set Cost Target", kind: "monster" },
      { code: "90000004", name: "Special Summon Cost Target", kind: "monster" },
    ];
    const reader = createCardReader(customCards);
    const session = createDuel({ seed: 793, startingHandSize: 5, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chainEnergyCode, chainEnergyCode, "90000001", "90000002", "90000004"] }, 1: { main: [] } });
    startDuel(session);

    const chainEnergyCopies = session.state.cards.filter((card) => card.code === chainEnergyCode);
    const source = chainEnergyCopies[0];
    const spellTarget = chainEnergyCopies[1];
    const summonTarget = session.state.cards.find((card) => card.code === "90000001");
    const setTarget = session.state.cards.find((card) => card.code === "90000002");
    const specialTarget = session.state.cards.find((card) => card.code === "90000004");
    expect(source).toBeDefined();
    expect(summonTarget).toBeDefined();
    expect(setTarget).toBeDefined();
    expect(specialTarget).toBeDefined();
    expect(spellTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "spellTrapZone", 0);
    source!.faceUp = true;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chainEnergyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 90, sourceUid: source!.uid }),
      expect.objectContaining({ code: 91, sourceUid: source!.uid }),
      expect.objectContaining({ code: 94, sourceUid: source!.uid }),
      expect.objectContaining({ code: 95, sourceUid: source!.uid }),
    ]));

    setDuelPlayerLifePoints(session.state, 0, 500);
    let actions = getLegalActions(session, 0);
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", uid: spellTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));
    expect(canSpecialSummonDuelCard(session.state, specialTarget!.uid, 0)).toBe(false);
    const restoredBlocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredBlocked.restoreComplete, restoredBlocked.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBlocked.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredBlocked, 0)).toEqual(getGroupedDuelLegalActions(restoredBlocked.session, 0));
    expect(getLuaRestoreLegalActions(restoredBlocked, 0)).toEqual(getLegalActions(restoredBlocked.session, 0));
    expect(getLuaRestoreLegalActions(restoredBlocked, 0)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", uid: spellTarget!.uid })]));
    expect(getLuaRestoreLegalActions(restoredBlocked, 0)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(getLuaRestoreLegalActions(restoredBlocked, 0)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(getLuaRestoreLegalActions(restoredBlocked, 0)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));
    expect(canSpecialSummonDuelCard(restoredBlocked.session.state, specialTarget!.uid, 0)).toBe(false);

    setDuelPlayerLifePoints(session.state, 0, 501);
    actions = getLegalActions(session, 0);
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", uid: spellTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));
    expect(canSpecialSummonDuelCard(session.state, specialTarget!.uid, 0)).toBe(true);
    specialSummonDuelCard(session.state, specialTarget!.uid, 0);
    expect(session.state.players[0].lifePoints).toBe(1);
    setDuelPlayerLifePoints(session.state, 0, 501);
    const activateSpell = actions.find((action) => action.type === "activateEffect" && action.uid === spellTarget!.uid);
    expect(activateSpell).toBeDefined();
    expect(applyResponse(session, activateSpell!).ok).toBe(true);
    expect(session.state.players[0].lifePoints).toBe(1);

    setDuelPlayerLifePoints(restoredBlocked.session.state, 0, 501);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(restoredBlocked.session), workspace, reader);
    expect(restoredOpen.restoreComplete, restoredOpen.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpen.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpen, 0)).toEqual(getGroupedDuelLegalActions(restoredOpen.session, 0));
    expect(getLuaRestoreLegalActions(restoredOpen, 0)).toEqual(getLegalActions(restoredOpen.session, 0));
    const restoredActions = getLuaRestoreLegalActions(restoredOpen, 0);
    expect(restoredActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", uid: spellTarget!.uid })]));
    expect(restoredActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(restoredActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(restoredActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));
    expect(canSpecialSummonDuelCard(restoredOpen.session.state, specialTarget!.uid, 0)).toBe(true);
    const restoredActivate = restoredActions.find((action) => action.type === "activateEffect" && action.uid === spellTarget!.uid);
    expect(restoredActivate).toBeDefined();
    expect(applyLuaRestoreResponse(restoredOpen, restoredActivate!).ok).toBe(true);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(1);
  });
});
