import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, tributeSummonDuelCard } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Apoqliphort tribute limit", () => {
  it("restores target-owned EFFECT_TRIBUTE_LIMIT material setcode checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const skybaseCode = "40061558";
    const qliCodes = ["900000255", "900000256", "900000257"];
    const offCode = "900000258";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === skybaseCode),
      ...qliCodes.map((code, index) => ({ code, name: `Qli Tribute ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1200, defense: 1000, setcodes: [0xaa] })),
      { code: offCode, name: "Off-Archetype Tribute", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 400, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [skybaseCode, ...qliCodes, offCode] }, 1: { main: [] } });
    startDuel(session);

    const skybase = session.state.cards.find((card) => card.code === skybaseCode);
    const qlis = qliCodes.map((code) => session.state.cards.find((card) => card.code === code));
    const off = session.state.cards.find((card) => card.code === offCode);
    expect(skybase).toBeDefined();
    expect(qlis.every(Boolean)).toBe(true);
    expect(off).toBeDefined();
    moveDuelCard(session.state, skybase!.uid, "hand", 0);
    for (const material of [...qlis, off]) moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skybaseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 154, sourceUid: skybase!.uid, luaValueDescriptor: "cannot-material:target-not-setcode:170" }),
      ]),
    );
    expect(skybase!.data.normalTributes).toBe(3);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const actions = getLegalActions(restored.session, 0);
    expect(actions.some((action) => action.type === "tributeSummon" && action.uid === skybase!.uid && action.tributeUids.includes(off!.uid))).toBe(false);
    expect(actions.some((action) => action.type === "tributeSummon" && action.uid === skybase!.uid && qlis.every((material) => action.tributeUids.includes(material!.uid)))).toBe(true);
    expect(() => tributeSummonDuelCard(restored.session.state, 0, skybase!.uid, [qlis[0]!.uid, qlis[1]!.uid, off!.uid])).toThrow("cannot be released");

    const allowed = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(allowed.restoreComplete, allowed.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(allowed, 0);
    expect(allowed.missingRegistryKeys).toEqual([]);
    tributeSummonDuelCard(allowed.session.state, 0, skybase!.uid, qlis.map((material) => material!.uid));
    expect(allowed.session.state.cards.find((card) => card.uid === skybase!.uid)).toMatchObject({ location: "monsterZone", summonType: "tribute" });
    for (const material of qlis) expect(allowed.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
  });
});
