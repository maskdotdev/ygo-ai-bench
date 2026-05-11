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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Diabolos effect release lock", () => {
  it("restores official EFFECT_UNRELEASABLE_EFFECT while leaving cost release legal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const diabolosCode = "29424328";
    const freeCode = "900000250";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === diabolosCode),
      { code: freeCode, name: "Free Effect Release", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 294, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [diabolosCode, freeCode] }, 1: { main: [] } });
    startDuel(session);

    const diabolos = session.state.cards.find((card) => card.code === diabolosCode);
    const free = session.state.cards.find((card) => card.code === freeCode);
    expect(diabolos).toBeDefined();
    expect(free).toBeDefined();
    moveDuelCard(session.state, diabolos!.uid, "monsterZone", 0);
    moveDuelCard(session.state, free!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(diabolosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 48, sourceUid: diabolos!.uid, value: 1 })]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local diabolos=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${diabolosCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local free=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${freeCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("diabolos release predicates " .. tostring(diabolos:IsReleasable()) .. "/" .. tostring(diabolos:IsReleasableByEffect()) .. "/" .. tostring(free:IsReleasableByEffect()))
      Debug.Message("diabolos effect release " .. Duel.Release(Group.FromCards(diabolos,free),REASON_EFFECT))
      `,
      "diabolos-effect-release-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("diabolos release predicates true/false/true");
    expect(restored.host.messages).toContain("diabolos effect release 1");
    expect(restored.session.state.cards.find((card) => card.uid === diabolos!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === free!.uid)).toMatchObject({ location: "graveyard" });

    const costRestored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(costRestored.restoreComplete, costRestored.incompleteReasons.join("; ")).toBe(true);
    const costProbe = costRestored.host.loadScript(
      `
      local diabolos=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${diabolosCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("diabolos cost release " .. Duel.Release(diabolos,REASON_COST))
      `,
      "diabolos-cost-release-probe.lua",
    );
    expect(costProbe.ok, costProbe.error).toBe(true);
    expect(costRestored.host.messages).toContain("diabolos cost release 1");
    expect(costRestored.session.state.cards.find((card) => card.uid === diabolos!.uid)).toMatchObject({ location: "graveyard" });
  });
});
