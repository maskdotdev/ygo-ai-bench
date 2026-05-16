import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tuned Magician Gemini tuner type", () => {
  it("restores Gemini status gating for official EFFECT_ADD_TYPE tuner checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tunedMagicianCode = "47459126";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tunedMagicianCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 332, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunedMagicianCode] }, 1: { main: [] } });
    startDuel(session);

    const tunedMagician = session.state.cards.find((card) => card.code === tunedMagicianCode && card.location === "deck");
    expect(tunedMagician).toBeDefined();
    moveDuelCard(session.state, tunedMagician!.uid, "monsterZone", 0);
    tunedMagician!.faceUp = true;
    tunedMagician!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tunedMagicianCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 0);
    expectRestoredLegalActions(restoredInitial, 1);
    assertGeminiTunerTraits(restoredInitial, tunedMagicianCode, false, false);

    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === tunedMagician!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restoredInitial, geminiSummon!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(summoned.legalActions).toEqual(getLuaRestoreLegalActions(restoredInitial, summoned.state.waitingFor!));
    expect(summoned.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restoredInitial, summoned.state.waitingFor!));
    expect(summoned.legalActionGroups.flatMap((group) => group.actions)).toEqual(summoned.legalActions);

    const restoredStatus = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), workspace, reader);
    expectCleanRestore(restoredStatus);
    expectRestoredLegalActions(restoredStatus, 0);
    expectRestoredLegalActions(restoredStatus, 1);
    assertGeminiTunerTraits(restoredStatus, tunedMagicianCode, true, true);
    expect(restoredStatus.session.state.cards.find((card) => card.uid === tunedMagician!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "normal",
      summonTypeCode: 0x12000000,
    });
    expect(restoredStatus.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: tunedMagician!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function assertGeminiTunerTraits(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, geminiStatus: boolean, tunerType: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,nil)
      Debug.Message("tuned magician gemini status " .. tostring(target and target:IsGeminiStatus()) .. " tuner " .. tostring(target and target:IsType(TYPE_TUNER)) .. "/" .. tostring(target and target:GetType()))
    `,
    "tuned-magician-gemini-tuner-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  const typeSuffix = tunerType ? "6177" : "2065";
  expect(restored.host.messages).toContain(`tuned magician gemini status ${geminiStatus ? "true" : "false"} tuner ${tunerType ? "true" : "false"}/${typeSuffix}`);
}
