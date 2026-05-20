import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Scrap Archfiend Synchro.NonTuner procedure", () => {
  it("restores default Synchro.AddProcedure tuner and non-tuner ranges", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const scrapArchfiendCode = "45815891";
    const tunerCode = "45815892";
    const nonTunerCode = "45815893";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === scrapArchfiendCode),
      { code: tunerCode, name: "Scrap Archfiend Level 3 Tuner", kind: "monster", typeFlags: 0x1001, level: 3, attack: 1200, defense: 1000 },
      { code: nonTunerCode, name: "Scrap Archfiend Level 4 Non-Tuner", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 458, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, nonTunerCode], extra: [scrapArchfiendCode] }, 1: { main: [] } });
    startDuel(session);

    const scrapArchfiend = requireCard(session, scrapArchfiendCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    moveDuelCard(session.state, tuner.uid, "monsterZone", 0);
    moveDuelCard(session.state, nonTuner.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(scrapArchfiendCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(workspace.readScript(`c${scrapArchfiendCode}.lua`)).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
    expect(session.state.cards.find((card) => card.uid === scrapArchfiend.uid)?.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === scrapArchfiend.uid)?.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));

    const synchro = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "synchroSummon" && action.uid === scrapArchfiend.uid);
    expect(synchro, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual({
      type: "synchroSummon",
      player: 0,
      uid: scrapArchfiend.uid,
      materialUids: [tuner.uid, nonTuner.uid],
      label: "Synchro Summon Scrap Archfiend using Scrap Archfiend Level 3 Tuner, Scrap Archfiend Level 4 Non-Tuner",
      windowId: 0,
      windowKind: "open",
      windowToken: "window-2",
    });
    const summoned = applyLuaRestoreResponse(restored, synchro!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === scrapArchfiend.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });
    for (const material of [tuner, nonTuner]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.material | duelReason.synchro,
      });
    }
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: scrapArchfiend.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
          position: "faceDown",
          sequence: 0,
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
