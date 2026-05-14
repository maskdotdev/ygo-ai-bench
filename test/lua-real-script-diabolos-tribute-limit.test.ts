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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Diabolos tribute limit", () => {
  it("restores official EFFECT_TRIBUTE_LIMIT target attribute checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const diabolosCode = "29424328";
    const lightTargetCode = "900000251";
    const darkTargetCode = "900000252";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === diabolosCode),
      { code: lightTargetCode, name: "Light Tribute Target", kind: "monster", typeFlags: 0x1, level: 5, attribute: 0x10, attack: 2000, defense: 1000 },
      { code: darkTargetCode, name: "Dark Tribute Target", kind: "monster", typeFlags: 0x1, level: 5, attribute: 0x20, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [diabolosCode, lightTargetCode, darkTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const diabolos = session.state.cards.find((card) => card.code === diabolosCode);
    const lightTarget = session.state.cards.find((card) => card.code === lightTargetCode);
    const darkTarget = session.state.cards.find((card) => card.code === darkTargetCode);
    expect(diabolos).toBeDefined();
    expect(lightTarget).toBeDefined();
    expect(darkTarget).toBeDefined();
    moveDuelCard(session.state, diabolos!.uid, "monsterZone", 0);
    moveDuelCard(session.state, lightTarget!.uid, "hand", 0);
    moveDuelCard(session.state, darkTarget!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(diabolosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 154, sourceUid: diabolos!.uid, luaValueDescriptor: "cannot-material:target-not-attribute:32" }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const actions = getLegalActions(restored.session, 0);
    expect(actions.some((action) => action.type === "tributeSummon" && action.uid === lightTarget!.uid)).toBe(false);
    expect(actions.some((action) => action.type === "tributeSummon" && action.uid === darkTarget!.uid)).toBe(true);
    expect(() => tributeSummonDuelCard(restored.session.state, 0, lightTarget!.uid, [diabolos!.uid])).toThrow("cannot be released");
    expect(restored.session.state.cards.find((card) => card.uid === lightTarget!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === diabolos!.uid)).toMatchObject({ location: "monsterZone" });

    const allowed = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(allowed.restoreComplete, allowed.incompleteReasons.join("; ")).toBe(true);
    expect(allowed.missingRegistryKeys).toEqual([]);
    tributeSummonDuelCard(allowed.session.state, 0, darkTarget!.uid, [diabolos!.uid]);
    expect(allowed.session.state.cards.find((card) => card.uid === darkTarget!.uid)).toMatchObject({ location: "monsterZone", summonType: "tribute" });
    expect(allowed.session.state.cards.find((card) => card.uid === diabolos!.uid)).toMatchObject({ location: "graveyard" });
  });
});
