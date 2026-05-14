import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Protector of the Sanctuary cannot draw", () => {
  it("restores official EFFECT_CANNOT_DRAW and keeps its phase condition active", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const protectorCode = "24221739";
    const drawCodeA = "900000261";
    const drawCodeB = "900000262";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === protectorCode),
      { code: drawCodeA, name: "Protector Draw Probe A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: drawCodeB, name: "Protector Draw Probe B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [protectorCode] }, 1: { main: [drawCodeA, drawCodeB] } });
    startDuel(session);

    const protector = session.state.cards.find((card) => card.code === protectorCode);
    expect(protector).toBeDefined();
    moveDuelCard(session.state, protector!.uid, "monsterZone", 0);
    protector!.position = "faceUpAttack";
    protector!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(protectorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 25,
          sourceUid: protector!.uid,
          targetRange: [0, 1],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const blocked = restored.host.loadScript(
      `
      Debug.Message("protector can draw main1 " .. tostring(Duel.IsPlayerCanDraw(1,1)))
      Debug.Message("protector draw main1 " .. Duel.Draw(1,1,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "protector-cannot-draw-main1-probe.lua",
    );
    expect(blocked.ok, blocked.error).toBe(true);
    expect(restored.host.messages).toContain("protector can draw main1 false");
    expect(restored.host.messages).toContain("protector draw main1 0/0");

    restored.session.state.phase = "draw";
    const allowed = restored.host.loadScript(
      `
      Debug.Message("protector can draw draw phase " .. tostring(Duel.IsPlayerCanDraw(1,1)))
      Debug.Message("protector draw draw phase " .. Duel.Draw(1,1,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "protector-cannot-draw-draw-phase-probe.lua",
    );
    expect(allowed.ok, allowed.error).toBe(true);
    expect(restored.host.messages).toContain("protector can draw draw phase true");
    expect(restored.host.messages).toContain("protector draw draw phase 1/1");
    expect(restored.session.state.cards.filter((card) => card.controller === 1 && card.location === "hand")).toHaveLength(1);
  });
});
