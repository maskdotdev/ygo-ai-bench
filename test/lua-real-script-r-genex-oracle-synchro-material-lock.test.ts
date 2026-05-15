import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script R-Genex Oracle Synchro material lock", () => {
  it("restores official target-filtered EFFECT_CANNOT_BE_SYNCHRO_MATERIAL", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oracleCode = "10178757";
    const nonTunerCode = "900000242";
    const nonGenexSynchroCode = "900000243";
    const genexSynchroCode = "900000244";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === oracleCode),
      { code: nonTunerCode, name: "Level 4 Non-Tuner", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      {
        code: nonGenexSynchroCode,
        name: "Non-Genex Synchro Fixture",
        kind: "extra",
        typeFlags: 0x2001,
        level: 5,
        attack: 2100,
        defense: 1600,
        synchroMaterials: { tuner: oracleCode, nonTuners: [nonTunerCode] },
      },
      {
        code: genexSynchroCode,
        name: "Genex Synchro Fixture",
        kind: "extra",
        typeFlags: 0x2001,
        setcodes: [0x2],
        level: 5,
        attack: 2100,
        defense: 1600,
        synchroMaterials: { tuner: oracleCode, nonTuners: [nonTunerCode] },
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 101, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oracleCode, nonTunerCode], extra: [nonGenexSynchroCode, genexSynchroCode] }, 1: { main: [] } });
    startDuel(session);

    const oracle = session.state.cards.find((card) => card.code === oracleCode);
    const nonTuner = session.state.cards.find((card) => card.code === nonTunerCode);
    const nonGenexSynchro = session.state.cards.find((card) => card.code === nonGenexSynchroCode);
    const genexSynchro = session.state.cards.find((card) => card.code === genexSynchroCode);
    expect(oracle).toBeDefined();
    expect(nonTuner).toBeDefined();
    expect(nonGenexSynchro).toBeDefined();
    expect(genexSynchro).toBeDefined();
    expect(genexSynchro!.data.setcodes).toEqual([0x2]);
    moveDuelCard(session.state, oracle!.uid, "monsterZone", 0);
    moveDuelCard(session.state, nonTuner!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(oracleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 236,
          sourceUid: oracle!.uid,
          luaValueDescriptor: "cannot-material:target-not-setcode:2",
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const legalActions = getLegalActions(restored.session, 0);
    expect(legalActions.some((action) => action.type === "synchroSummon" && action.uid === nonGenexSynchro!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(restored.session.state, 0, nonGenexSynchro!.uid, [oracle!.uid, nonTuner!.uid])).toThrow("cannot be used as synchro material");
    expect(restored.session.state.cards.find((card) => card.uid === nonGenexSynchro!.uid)).toMatchObject({ location: "extraDeck" });
    expect(restored.session.state.cards.find((card) => card.uid === oracle!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === nonTuner!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
