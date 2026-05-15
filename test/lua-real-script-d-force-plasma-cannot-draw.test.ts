import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D - Force Plasma cannot draw", () => {
  it("restores official conditional EFFECT_CANNOT_DRAW only while Plasma is present in Draw Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dForceCode = "6186304";
    const plasmaCode = "83965310";
    const drawCodeA = "900000570";
    const drawCodeB = "900000571";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dForceCode || card.code === plasmaCode),
      { code: drawCodeA, name: "D Force Draw Probe A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: drawCodeB, name: "D Force Draw Probe B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 618, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dForceCode, plasmaCode, drawCodeA, drawCodeB] }, 1: { main: [] } });
    startDuel(session);

    const dForce = session.state.cards.find((card) => card.code === dForceCode);
    const plasma = session.state.cards.find((card) => card.code === plasmaCode);
    expect(dForce).toBeDefined();
    expect(plasma).toBeDefined();
    moveDuelCard(session.state, dForce!.uid, "spellTrapZone", 0);
    dForce!.faceUp = true;
    moveDuelCard(session.state, plasma!.uid, "monsterZone", 0);
    plasma!.faceUp = true;
    plasma!.position = "faceUpAttack";
    session.state.phase = "draw";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dForceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 25 && effect.sourceUid === dForce!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 25,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-25",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "property": 2048,
        "range": [
          "spellTrapZone",
        ],
        "registryKey": "lua:6186304:lua-2-25",
        "sourceUid": "p0-deck-6186304-0",
        "target": [Function],
        "targetRange": [
          1,
          0,
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );

    const blocked = restored.host.loadScript(
      `
      Debug.Message("d force can draw with plasma draw phase " .. tostring(Duel.IsPlayerCanDraw(0,1)))
      Debug.Message("d force draw with plasma draw phase " .. Duel.Draw(0,1,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "d-force-plasma-draw-phase-probe.lua",
    );
    expect(blocked.ok, blocked.error).toBe(true);
    expect(restored.host.messages).toContain("d force can draw with plasma draw phase false");
    expect(restored.host.messages).toContain("d force draw with plasma draw phase 0/0");

    restored.session.state.phase = "main1";
    const allowedMain = restored.host.loadScript(
      `
      Debug.Message("d force can draw with plasma main1 " .. tostring(Duel.IsPlayerCanDraw(0,1)))
      Debug.Message("d force draw with plasma main1 " .. Duel.Draw(0,1,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "d-force-plasma-main1-probe.lua",
    );
    expect(allowedMain.ok, allowedMain.error).toBe(true);
    expect(restored.host.messages).toContain("d force can draw with plasma main1 true");
    expect(restored.host.messages).toContain("d force draw with plasma main1 1/1");
    expect(restored.session.state.cards.filter((card) => card.controller === 0 && card.location === "hand")).toHaveLength(1);

    moveDuelCard(restored.session.state, plasma!.uid, "graveyard", 0);
    restored.session.state.phase = "draw";
    const allowedNoPlasma = restored.host.loadScript(
      `
      Debug.Message("d force can draw without plasma draw phase " .. tostring(Duel.IsPlayerCanDraw(0,1)))
      Debug.Message("d force draw without plasma draw phase " .. Duel.Draw(0,1,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "d-force-no-plasma-draw-phase-probe.lua",
    );
    expect(allowedNoPlasma.ok, allowedNoPlasma.error).toBe(true);
    expect(restored.host.messages).toContain("d force can draw without plasma draw phase true");
    expect(restored.host.messages).toContain("d force draw without plasma draw phase 1/1");
    expect(restored.session.state.cards.filter((card) => card.controller === 0 && card.location === "hand")).toHaveLength(2);
  });
});
