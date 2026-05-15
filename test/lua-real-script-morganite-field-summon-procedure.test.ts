import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Morganite field summon procedure", () => {
  it("restores Morganite's field-granted no-tribute summon procedure for a high-level monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const morganiteCode = "61822419";
    const highLevelCode = "61822420";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === morganiteCode),
      { code: highLevelCode, name: "Morganite High-Level Normal", kind: "monster", typeFlags: 0x1, level: 6, attack: 2100, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 618, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [morganiteCode, highLevelCode] }, 1: { main: [] } });
    startDuel(session);

    const morganite = requireCard(session, morganiteCode);
    const highLevel = requireCard(session, highLevelCode);
    moveDuelCard(session.state, morganite.uid, "hand", 0);
    moveDuelCard(session.state, highLevel.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(morganiteCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === morganite.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activation!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === morganite.uid)).toMatchObject({ location: "graveyard" });

    const summon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "tributeSummon" && action.uid === highLevel.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual(expect.objectContaining({
      type: "tributeSummon",
      effectId: expect.stringMatching(/^lua-/),
      tributeUids: [],
    }));
    const summoned = applyLuaRestoreResponse(restored, summon!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === highLevel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
      summonMaterialUids: [],
    });
    expect(restored.session.state.players[0].normalSummonAvailable).toBe(false);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: highLevel.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
