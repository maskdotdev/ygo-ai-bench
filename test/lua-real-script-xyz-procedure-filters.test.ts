import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Xyz procedure filters", () => {
  it("restores official Xyz.AddProcedure FilterBoolFunction race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const melffyMommyCode = "76833149";
    const warriorMaterialCodes = ["900000161", "900000162"];
    const beastMaterialCodes = ["900000163", "900000164"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === melffyMommyCode),
      ...warriorMaterialCodes.map((code, index) => ({
        code,
        name: `Warrior Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 2,
        race: 0x1,
      })),
      ...beastMaterialCodes.map((code, index) => ({
        code,
        name: `Beast Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 2,
        race: 0x4000,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [melffyMommyCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === melffyMommyCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(melffyMommyCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
        xyzMaterialCount: 2,
        xyzMaterialRace: 0x4000,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, xyz };
    };

    const wrongRace = restoreWithMaterials(warriorMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRace.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongRace.xyz!.uid)).toBe(false);

    const matchingRace = restoreWithMaterials(beastMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingRace.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingRace.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingRace.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingRace.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingRace.restored.session.state.cards.find((card) => card.uid === matchingRace.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });
});
