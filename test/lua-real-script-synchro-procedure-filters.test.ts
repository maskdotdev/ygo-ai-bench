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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Synchro procedure filters", () => {
  it("restores official Synchro.AddProcedure non-tuner race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const overmindArchfiendCode = "24221808";
    const machineMaterialCodes = ["900000131", "900000132", "900000133"];
    const psychicMaterialCodes = ["900000134", "900000135", "900000136"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === overmindArchfiendCode),
      { code: machineMaterialCodes[0]!, name: "Psychic Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, race: 0x100000 },
      { code: machineMaterialCodes[1]!, name: "Machine Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, race: 0x20 },
      { code: machineMaterialCodes[2]!, name: "Second Machine Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, race: 0x20 },
      { code: psychicMaterialCodes[0]!, name: "Second Psychic Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, race: 0x100000 },
      { code: psychicMaterialCodes[1]!, name: "Psychic Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, race: 0x100000 },
      { code: psychicMaterialCodes[2]!, name: "Second Psychic Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, race: 0x100000 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 308, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [overmindArchfiendCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === overmindArchfiendCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(overmindArchfiendCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerRace: 0x100000,
        synchroNonTunerMin: 2,
        synchroNonTunerMax: 99,
        synchroNonTunerRace: 0x100000,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongNonTuners = restoreWithMaterials(machineMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongNonTuners.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongNonTuners.synchro!.uid)).toBe(false);

    const matchingNonTuners = restoreWithMaterials(psychicMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingNonTuners.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingNonTuners.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingNonTuners.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingNonTuners.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingNonTuners.restored.session.state.cards.find((card) => card.uid === matchingNonTuners.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("restores official Synchro.AddProcedure non-tuner type filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bladeBlasterCode = "51447164";
    const effectMaterialCodes = ["900000141", "900000142"];
    const synchroMaterialCodes = ["900000143", "900000144"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bladeBlasterCode),
      { code: effectMaterialCodes[0]!, name: "Synchro Level 5 Tuner", kind: "extra" as const, typeFlags: 0x3001, level: 5 },
      { code: effectMaterialCodes[1]!, name: "Effect Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
      { code: synchroMaterialCodes[0]!, name: "Second Synchro Level 5 Tuner", kind: "extra" as const, typeFlags: 0x3001, level: 5 },
      { code: synchroMaterialCodes[1]!, name: "Synchro Level 5 Non-Tuner", kind: "extra" as const, typeFlags: 0x2001, level: 5 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 309, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [bladeBlasterCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === bladeBlasterCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(bladeBlasterCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerType: 0x2000,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
        synchroNonTunerType: 0x2000,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongNonTuner = restoreWithMaterials(effectMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongNonTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongNonTuner.synchro!.uid)).toBe(false);

    const matchingNonTuner = restoreWithMaterials(synchroMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingNonTuner.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingNonTuner.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingNonTuner.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingNonTuner.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingNonTuner.restored.session.state.cards.find((card) => card.uid === matchingNonTuner.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });
});
