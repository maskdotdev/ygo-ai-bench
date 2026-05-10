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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Link procedure filters", () => {
  it("restores official Link.AddProcedure ORed race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const seleneSnapperCode = "75352507";
    const warriorMaterialCodes = ["900000151", "900000152", "900000153"];
    const plantMaterialCodes = ["900000154", "900000155", "900000156"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === seleneSnapperCode),
      ...warriorMaterialCodes.map((code, index) => ({
        code,
        name: `Warrior Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        race: 0x1,
      })),
      ...plantMaterialCodes.map((code, index) => ({
        code,
        name: `Plant Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        race: 0x400,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 310, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [seleneSnapperCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === seleneSnapperCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(seleneSnapperCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 2,
        linkMaterialRace: 0x80c00,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, link };
    };

    const wrongRace = restoreWithMaterials(warriorMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRace.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongRace.link!.uid)).toBe(false);

    const matchingRace = restoreWithMaterials(plantMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingRace.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingRace.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingRace.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingRace.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingRace.restored.session.state.cards.find((card) => card.uid === matchingRace.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Link.AddProcedure setcode filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const qualiarkCode = "92781606";
    const offSetMaterialCodes = ["900000171", "900000172"];
    const krawlerMaterialCodes = ["900000173", "900000174"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === qualiarkCode),
      ...offSetMaterialCodes.map((code, index) => ({
        code,
        name: `Off-Set Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        setcodes: [0x123],
      })),
      ...krawlerMaterialCodes.map((code, index) => ({
        code,
        name: `Krawler Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        setcodes: [0x104],
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 313, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [qualiarkCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === qualiarkCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(qualiarkCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 2,
        linkMaterialMax: 2,
        linkMaterialSetcode: 0x104,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, link };
    };

    const wrongSetcode = restoreWithMaterials(offSetMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongSetcode.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongSetcode.link!.uid)).toBe(false);

    const matchingSetcode = restoreWithMaterials(krawlerMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingSetcode.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingSetcode.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingSetcode.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingSetcode.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingSetcode.restored.session.state.cards.find((card) => card.uid === matchingSetcode.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Link.AddProcedure level filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const linkuribohCode = "41999284";
    const levelTwoMaterialCode = "900000175";
    const levelOneMaterialCode = "900000176";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === linkuribohCode),
      { code: levelTwoMaterialCode, name: "Level 2 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 2 },
      { code: levelOneMaterialCode, name: "Level 1 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 1 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterial = (code: string) => {
      const session = createDuel({ seed: 316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [code], extra: [linkuribohCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === linkuribohCode && card.location === "extraDeck");
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(link).toBeDefined();
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(linkuribohCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 1,
        linkMaterialLevel: 1,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, link };
    };

    const wrongLevel = restoreWithMaterial(levelTwoMaterialCode);
    expect(getLuaRestoreLegalActions(wrongLevel.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongLevel.link!.uid)).toBe(false);

    const matchingLevel = restoreWithMaterial(levelOneMaterialCode);
    const actions = getLuaRestoreLegalActions(matchingLevel.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingLevel.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingLevel.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingLevel.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingLevel.restored.session.state.cards.find((card) => card.uid === matchingLevel.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });
});
