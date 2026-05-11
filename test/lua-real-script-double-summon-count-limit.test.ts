import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Double Summon count limit", () => {
  it("lets official Double Summon grant a second Normal Summon legal action", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const doubleSummonCode = "43422537";
    const doubleSummon = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === doubleSummonCode);
    expect(doubleSummon).toBeDefined();
    const cards: DuelCardData[] = [
      doubleSummon!,
      { code: "90000021", name: "Double Summon First", kind: "monster", level: 4 },
      { code: "90000022", name: "Double Summon Second", kind: "monster", level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 434, startingHandSize: 3, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [doubleSummonCode, "90000021", "90000022"] }, 1: { main: [] } });
    startDuel(session);

    const spell = session.state.cards.find((card) => card.code === doubleSummonCode);
    const first = session.state.cards.find((card) => card.code === "90000021");
    const second = session.state.cards.find((card) => card.code === "90000022");
    expect(spell).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doubleSummonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === spell!.uid);
    expect(activate).toBeDefined();
    expect(applyResponse(session, activate!).ok).toBe(true);
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 28, value: 2, controller: 0 })]));

    const firstSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === first!.uid);
    expect(firstSummon).toBeDefined();
    expect(applyResponse(session, firstSummon!).ok).toBe(true);

    const secondSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === second!.uid);
    expect(secondSummon).toBeDefined();
    expect(applyResponse(session, secondSummon!).ok).toBe(true);
    expect(session.state.activityCounts[0].normalSummon).toBe(2);
  });
});
