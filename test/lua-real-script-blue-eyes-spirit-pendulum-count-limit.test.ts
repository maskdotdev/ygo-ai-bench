import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

const blueEyesSpiritDragonCode = "59822133";
const pendulumCards: DuelCardData[] = [
  { code: "100", name: "Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
  { code: "200", name: "High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
  { code: "300", name: "First Pendulum", kind: "monster", typeFlags: 0x1000001, level: 4 },
  { code: "301", name: "Second Pendulum", kind: "monster", typeFlags: 0x1000001, level: 5 },
];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blue-Eyes Spirit Dragon Pendulum count limit", () => {
  it("limits public and Lua Pendulum Summons to one simultaneous monster", () => {
    const { first, reader, second, session, workspace } = createSpiritPendulumSession(305);

    expect(pendulumSummonActions(session)).toEqual([
      expect.objectContaining({ maxSummons: 4, summonUids: [first.uid, second.uid] }),
    ]);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blueEyesSpiritDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restrictedActions = pendulumSummonActions(session);
    expect(restrictedActions).toEqual([
      expect.objectContaining({ maxSummons: 1, summonUids: [first.uid, second.uid] }),
    ]);
    const restrictedAction = restrictedActions[0]!;
    expect(applyResponse(session, { ...restrictedAction, summonUids: [first.uid, second.uid] }).ok).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(pendulumSummonActions(restored.session)).toEqual([
      expect.objectContaining({ maxSummons: 1, summonUids: [first.uid, second.uid] }),
    ]);

    const check = host.loadScript(
      `
      Debug.Message("spirit count one " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0,1)))
      Debug.Message("spirit count two " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0,2)))
      Debug.Message("spirit pendulum can " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      `,
      "blue-eyes-spirit-count-check.lua",
    );
    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("spirit count one true");
    expect(host.messages).toContain("spirit count two false");
    expect(host.messages).toContain("spirit pendulum can true");

    const applied = applyResponse(session, { ...restrictedAction, summonUids: [first.uid] });
    expect(applied.ok, applied.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === first.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
    expect(session.state.cards.find((card) => card.uid === second.uid)).toMatchObject({ location: "hand" });
  });

  it("limits direct Lua Duel.PendulumSummon to one simultaneous monster", () => {
    const { first, second, session, workspace } = createSpiritPendulumSession(306);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blueEyesSpiritDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      Debug.Message("spirit pendulum summoned " .. Duel.PendulumSummon(0))
      `,
      "blue-eyes-spirit-pendulum-summon.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("spirit pendulum summoned 1");
    expect(session.state.cards.find((card) => card.uid === first.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
    expect(session.state.cards.find((card) => card.uid === second.uid)).toMatchObject({ location: "hand" });
  });
});

function createSpiritPendulumSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const blueEyesCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === blueEyesSpiritDragonCode);
  expect(blueEyesCard).toBeDefined();
  const reader = createCardReader([blueEyesCard!, ...pendulumCards]);
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [blueEyesSpiritDragonCode, "100", "200", "300", "301"] }, 1: { main: [] } });
  startDuel(session);

  const blueEyes = session.state.cards.find((card) => card.code === blueEyesSpiritDragonCode);
  const lowScale = session.state.cards.find((card) => card.code === "100");
  const highScale = session.state.cards.find((card) => card.code === "200");
  const first = session.state.cards.find((card) => card.code === "300");
  const second = session.state.cards.find((card) => card.code === "301");
  expect(blueEyes).toBeDefined();
  expect(lowScale).toBeDefined();
  expect(highScale).toBeDefined();
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  moveDuelCard(session.state, blueEyes!.uid, "monsterZone", 0);
  blueEyes!.faceUp = true;
  blueEyes!.position = "faceUpAttack";
  moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
  moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;
  moveDuelCard(session.state, first!.uid, "hand", 0);
  moveDuelCard(session.state, second!.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  return { first: first!, reader, second: second!, session, workspace };
}

function pendulumSummonActions(session: DuelSession): Array<Extract<DuelAction, { type: "pendulumSummon" }>> {
  return getDuelLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon");
}
