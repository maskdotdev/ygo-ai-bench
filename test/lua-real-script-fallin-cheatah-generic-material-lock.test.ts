import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  fusionSummonDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions,
  linkSummonDuelCard,
  loadDecks,
  ritualSummonDuelCard,
  serializeDuel,
  startDuel,
  synchroSummonDuelCard,
  xyzSummonDuelCard,
} from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { luaSummonTypeFusion, luaSummonTypeLink, luaSummonTypeSynchro, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fallin' Cheatah material lock", () => {
  it("restores official aux.cannotmatfilter generic material lock by summon type", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cheatahCode = "59011257";
    const freeMaterialCode = "900000260";
    const fusionCode = "900000261";
    const synchroCode = "900000262";
    const xyzCode = "900000263";
    const linkCode = "900000264";
    const ritualCode = "900000265";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cheatahCode),
      { code: freeMaterialCode, name: "Free Material", kind: "monster", typeFlags: 0x1001, level: 3, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Cheatah Fusion Fixture", kind: "extra", typeFlags: 0x41, level: 8, attack: 2000, defense: 2000, fusionMaterials: [cheatahCode, freeMaterialCode] },
      { code: synchroCode, name: "Cheatah Synchro Fixture", kind: "extra", typeFlags: 0x2001, level: 6, attack: 2000, defense: 2000, synchroMaterials: { tuner: freeMaterialCode, nonTuners: [cheatahCode] } },
      { code: xyzCode, name: "Cheatah Xyz Fixture", kind: "extra", typeFlags: 0x800001, level: 3, attack: 2000, defense: 2000, xyzMaterialCount: 2 },
      { code: linkCode, name: "Cheatah Link Fixture", kind: "extra", typeFlags: 0x4000001, attack: 2000, level: 2, linkMaterials: [cheatahCode, freeMaterialCode] },
      { code: ritualCode, name: "Cheatah Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 6, attack: 2000, defense: 2000, ritualMaterials: [cheatahCode, freeMaterialCode] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 590, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cheatahCode, freeMaterialCode, ritualCode], extra: [fusionCode, synchroCode, xyzCode, linkCode] }, 1: { main: [] } });
    startDuel(session);

    const cheatah = session.state.cards.find((card) => card.code === cheatahCode);
    const freeMaterial = session.state.cards.find((card) => card.code === freeMaterialCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const synchro = session.state.cards.find((card) => card.code === synchroCode);
    const xyz = session.state.cards.find((card) => card.code === xyzCode);
    const link = session.state.cards.find((card) => card.code === linkCode);
    const ritual = session.state.cards.find((card) => card.code === ritualCode);
    expect(cheatah).toBeDefined();
    expect(freeMaterial).toBeDefined();
    expect(fusion).toBeDefined();
    expect(synchro).toBeDefined();
    expect(xyz).toBeDefined();
    expect(link).toBeDefined();
    expect(ritual).toBeDefined();
    moveDuelCard(session.state, cheatah!.uid, "monsterZone", 0);
    moveDuelCard(session.state, freeMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ritual!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cheatahCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 248,
          sourceUid: cheatah!.uid,
          luaValueDescriptor: `cannot-material:summon-types:${luaSummonTypeFusion},${luaSummonTypeSynchro},${luaSummonTypeXyz},${luaSummonTypeLink}`,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const actions = getLegalActions(restored.session, 0);
    expect(actions.some((action) => action.type === "fusionSummon" && action.uid === fusion!.uid)).toBe(false);
    expect(actions.some((action) => action.type === "synchroSummon" && action.uid === synchro!.uid)).toBe(false);
    expect(actions.some((action) => action.type === "xyzSummon" && action.uid === xyz!.uid)).toBe(false);
    expect(actions.some((action) => action.type === "linkSummon" && action.uid === link!.uid)).toBe(false);
    expect(() => fusionSummonDuelCard(restored.session.state, 0, fusion!.uid, [cheatah!.uid, freeMaterial!.uid])).toThrow("cannot be used as fusion material");
    expect(() => synchroSummonDuelCard(restored.session.state, 0, synchro!.uid, [cheatah!.uid, freeMaterial!.uid])).toThrow("cannot be used as synchro material");
    expect(() => xyzSummonDuelCard(restored.session.state, 0, xyz!.uid, [cheatah!.uid, freeMaterial!.uid])).toThrow("cannot be used as Xyz material");
    expect(() => linkSummonDuelCard(restored.session.state, 0, link!.uid, [cheatah!.uid, freeMaterial!.uid])).toThrow("cannot be used as Link material");
    expect(() => ritualSummonDuelCard(restored.session.state, 0, ritual!.uid, [cheatah!.uid, freeMaterial!.uid])).not.toThrow();
    expect(restored.session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
