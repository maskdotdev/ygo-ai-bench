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

  it("restores official Xyz.AddProcedure infinite material ranges for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const melffyMommyCode = "76833149";
    const beastMaterialCodes = ["900000199", "900000200", "900000201"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === melffyMommyCode),
      ...beastMaterialCodes.map((code, index) => ({
        code,
        name: `Extra Beast Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 2,
        race: 0x4000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 321, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: beastMaterialCodes, extra: [melffyMommyCode] }, 1: { main: [] } });
    startDuel(session);
    const xyz = session.state.cards.find((card) => card.code === melffyMommyCode && card.location === "extraDeck");
    expect(xyz).toBeDefined();
    for (const code of beastMaterialCodes) {
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
      xyzMaterialMax: 99,
      xyzMaterialRace: 0x4000,
    });
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid && candidate.materialUids.length === 3);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    if (!action || action.type !== "xyzSummon") throw new Error("Expected three-material Xyz Summon action");
    const summoned = applyLuaRestoreResponse(restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
      overlayUids: expect.arrayContaining(beastMaterialCodes.map((code) => expect.stringContaining(code))),
    });
    expect(restored.session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toHaveLength(3);
  });

  it("restores official Xyz.AddProcedure setcode filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gigantesDollCode = "7593748";
    const offSetMaterialCodes = ["900000165", "900000166"];
    const gimmickPuppetMaterialCodes = ["900000167", "900000168"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gigantesDollCode),
      ...offSetMaterialCodes.map((code, index) => ({
        code,
        name: `Off-Set Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        setcodes: [0x123],
      })),
      ...gimmickPuppetMaterialCodes.map((code, index) => ({
        code,
        name: `Gimmick Puppet Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        setcodes: [0x1083],
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [gigantesDollCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === gigantesDollCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(gigantesDollCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
        xyzMaterialCount: 2,
        xyzMaterialSetcode: 0x1083,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, xyz };
    };

    const wrongSetcode = restoreWithMaterials(offSetMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongSetcode.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongSetcode.xyz!.uid)).toBe(false);

    const matchingSetcode = restoreWithMaterials(gimmickPuppetMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingSetcode.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingSetcode.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingSetcode.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingSetcode.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingSetcode.restored.session.state.cards.find((card) => card.uid === matchingSetcode.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });

  it("restores official Xyz.AddProcedure rank filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const disasterCode = "67359907";
    const levelMaterialCodes = ["900000189", "900000190"];
    const rankMaterialCodes = ["900000191", "900000192"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === disasterCode),
      ...levelMaterialCodes.map((code, index) => ({
        code,
        name: `Level 7 Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 7,
      })),
      ...rankMaterialCodes.map((code, index) => ({
        code,
        name: `Rank 7 Xyz Material ${index + 1}`,
        kind: "extra" as const,
        typeFlags: 0x800001,
        level: 7,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 318, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [disasterCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === disasterCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(disasterCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
        xyzMaterialCount: 2,
        xyzMaterialRank: 7,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, xyz };
    };

    const wrongRank = restoreWithMaterials(levelMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRank.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongRank.xyz!.uid)).toBe(false);

    const matchingRank = restoreWithMaterials(rankMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingRank.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingRank.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingRank.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingRank.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingRank.restored.session.state.cards.find((card) => card.uid === matchingRank.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });
});
