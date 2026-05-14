import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
      expect(host.registerInitialEffects()).toBe(1);
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
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
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
      expect(host.registerInitialEffects()).toBe(1);
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

  it("restores official Synchro.AddProcedure tuner level filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const luluwalilithCode = "53971455";
    const wrongTunerMaterialCodes = ["900000193", "900000194"];
    const matchingTunerMaterialCodes = ["900000195", "900000196"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === luluwalilithCode),
      { code: wrongTunerMaterialCodes[0]!, name: "Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3 },
      { code: wrongTunerMaterialCodes[1]!, name: "Level 9 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 9 },
      { code: matchingTunerMaterialCodes[0]!, name: "Level 4 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 4 },
      { code: matchingTunerMaterialCodes[1]!, name: "Level 8 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 8 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 319, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [luluwalilithCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === luluwalilithCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(luluwalilithCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerLevel: 4,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongTuner = restoreWithMaterials(wrongTunerMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongTuner.synchro!.uid)).toBe(false);

    const matchingTuner = restoreWithMaterials(matchingTunerMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingTuner.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingTuner.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingTuner.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingTuner.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingTuner.restored.session.state.cards.find((card) => card.uid === matchingTuner.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("uses restored Synchro material filters for Lua Duel.SynchroSummon default material selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const swordsoulsCode = "74405783";
    const wrongMaterialCodes = ["900000205", "900000206"];
    const matchingMaterialCodes = ["900000207", "900000208"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === swordsoulsCode),
      { code: wrongMaterialCodes[0]!, name: "Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3 },
      { code: wrongMaterialCodes[1]!, name: "Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
      { code: matchingMaterialCodes[0]!, name: "Level 4 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 4 },
      { code: matchingMaterialCodes[1]!, name: "Level 4 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 323, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [...wrongMaterialCodes, ...matchingMaterialCodes], extra: [swordsoulsCode] }, 1: { main: [] } });
    startDuel(session);
    const synchro = session.state.cards.find((card) => card.code === swordsoulsCode && card.location === "extraDeck");
    expect(synchro).toBeDefined();
    for (const code of [...wrongMaterialCodes, ...matchingMaterialCodes]) {
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(swordsoulsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroTunerLevel: 4,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });
    const result = host.loadScript(
      `
      local synchro=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${swordsoulsCode}),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("default synchro tuner filter " .. Duel.SynchroSummon(synchro))
      `,
      "swordsouls-default-synchro.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("default synchro tuner filter 1");
    const summoned = session.state.cards.find((card) => card.uid === synchro!.uid);
    const summonMaterialUids = summoned?.summonMaterialUids;
    expect(summoned).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
      summonMaterialUids: expect.arrayContaining(matchingMaterialCodes.map((code) => expect.stringContaining(code))),
    });
    if (!summoned) throw new Error("Expected Synchro Summoned monster");
    expect(summonMaterialUids).toHaveLength(2);
  });

  it("skips material locks for Lua Duel.SynchroSummon default material selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const swordsoulsCode = "74405783";
    const lockedTunerCode = "900000216";
    const allowedTunerCode = "900000217";
    const nonTunerCode = "900000218";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === swordsoulsCode),
      { code: lockedTunerCode, name: "Locked Level 4 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 4 },
      { code: allowedTunerCode, name: "Allowed Level 4 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 4 },
      { code: nonTunerCode, name: "Level 4 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 327, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lockedTunerCode, allowedTunerCode, nonTunerCode], extra: [swordsoulsCode] }, 1: { main: [] } });
    startDuel(session);
    const synchro = session.state.cards.find((card) => card.code === swordsoulsCode && card.location === "extraDeck");
    expect(synchro).toBeDefined();
    for (const code of [lockedTunerCode, allowedTunerCode, nonTunerCode]) {
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(swordsoulsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroTunerLevel: 4,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });
    const result = host.loadScript(
      `
      local blocked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${lockedTunerCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local e=Effect.CreateEffect(blocked)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)
      e:SetRange(LOCATION_MZONE)
      blocked:RegisterEffect(e)
      local synchro=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${swordsoulsCode}),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("default synchro material lock " .. Duel.SynchroSummon(synchro))
      `,
      "swordsouls-default-synchro-material-lock.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("default synchro material lock 1");
    const summoned = session.state.cards.find((card) => card.uid === synchro!.uid);
    const summonMaterialUids = summoned?.summonMaterialUids;
    const lockedTuner = session.state.cards.find((card) => card.code === lockedTunerCode);
    const allowedTuner = session.state.cards.find((card) => card.code === allowedTunerCode);
    const nonTuner = session.state.cards.find((card) => card.code === nonTunerCode);
    expect(summoned).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
      summonMaterialUids: expect.arrayContaining([allowedTuner?.uid, nonTuner?.uid]),
    });
    if (!summoned) throw new Error("Expected Synchro Summoned monster");
    expect(summonMaterialUids).toHaveLength(2);
    expect(summonMaterialUids).not.toContain(lockedTuner?.uid);
    expect(lockedTuner?.location).toBe("monsterZone");
  });

  it("restores official Synchro.AddProcedure tuner setcode filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gormfaobharCode = "36556781";
    const offSetTunerMaterialCodes = ["900000181", "900000182"];
    const dragunityTunerMaterialCodes = ["900000183", "900000184"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gormfaobharCode),
      { code: offSetTunerMaterialCodes[0]!, name: "Off-Set Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, setcodes: [0x123] },
      { code: offSetTunerMaterialCodes[1]!, name: "Level 4 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 4 },
      { code: dragunityTunerMaterialCodes[0]!, name: "Dragunity Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, setcodes: [0x29] },
      { code: dragunityTunerMaterialCodes[1]!, name: "Second Level 4 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 314, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [gormfaobharCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === gormfaobharCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(gormfaobharCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerSetcode: 0x29,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongTuner = restoreWithMaterials(offSetTunerMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongTuner.synchro!.uid)).toBe(false);

    const matchingTuner = restoreWithMaterials(dragunityTunerMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingTuner.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingTuner.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingTuner.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingTuner.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingTuner.restored.session.state.cards.find((card) => card.uid === matchingTuner.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("restores official Synchro.AddProcedure non-tuner setcode filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shiEnCode = "29981921";
    const offSetNonTunerMaterialCodes = ["900000185", "900000186"];
    const sixSamuraiNonTunerMaterialCodes = ["900000187", "900000188"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shiEnCode),
      { code: offSetNonTunerMaterialCodes[0]!, name: "Warrior Level 2 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 2, race: 0x1 },
      { code: offSetNonTunerMaterialCodes[1]!, name: "Off-Set Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, setcodes: [0x123] },
      { code: sixSamuraiNonTunerMaterialCodes[0]!, name: "Second Warrior Level 2 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 2, race: 0x1 },
      { code: sixSamuraiNonTunerMaterialCodes[1]!, name: "Six Samurai Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, setcodes: [0x3d] },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 315, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [shiEnCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === shiEnCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(shiEnCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerRace: 0x1,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
        synchroNonTunerSetcode: 0x3d,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongNonTuner = restoreWithMaterials(offSetNonTunerMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongNonTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongNonTuner.synchro!.uid)).toBe(false);

    const matchingNonTuner = restoreWithMaterials(sixSamuraiNonTunerMaterialCodes);
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
