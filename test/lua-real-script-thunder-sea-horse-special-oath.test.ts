import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Thunder Sea Horse special summon oath", () => {
  it("restores its cost-created temporary EFFECT_CANNOT_SPECIAL_SUMMON and expires it at End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const seaHorseCode = "48049769";
    const searchCode = "900000282";
    const summonProbeCode = "900000283";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === seaHorseCode),
      { code: searchCode, name: "Thunder Sea Horse Search Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1500, defense: 1000 },
      { code: summonProbeCode, name: "Thunder Sea Horse Summon Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [seaHorseCode, searchCode, searchCode, summonProbeCode] }, 1: { main: [] } });
    startDuel(session);

    const seaHorse = session.state.cards.find((card) => card.code === seaHorseCode);
    const summonProbe = session.state.cards.find((card) => card.code === summonProbeCode);
    expect(seaHorse).toBeDefined();
    expect(summonProbe).toBeDefined();
    moveDuelCard(session.state, seaHorse!.uid, "hand", 0);
    moveDuelCard(session.state, summonProbe!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(seaHorseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${seaHorseCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${seaHorseCode}.cost(e,0,nil,0,0,nil,0,0,1)
      c${seaHorseCode}.target(e,0,nil,0,0,nil,0,0,1)
      c${seaHorseCode}.operation(e,0,nil,0,0,nil,0,0)
      `,
      "thunder-sea-horse-official-resolution.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredLock, 0)).toEqual(getGroupedDuelLegalActions(restoredLock.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredLock, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredLock, 0));
    expect(getLuaRestoreLegalActions(restoredLock, 0)).toEqual(getLegalActions(restoredLock.session, 0));
    assertSpecialProbe(restoredLock, summonProbeCode, "locked", ["sea horse can special locked false", "sea horse special locked 0"]);

    const endTurn = getLegalActions(restoredLock.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restoredLock.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
    assertSpecialProbe(restoredLock, summonProbeCode, "after end", ["sea horse can special after end true", "sea horse special after end 1"]);
  });
});

function assertSpecialProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, summonProbeCode: string, label: string, expected: string[]): void {
  const probe = restored.host.loadScript(
    `
    local probe=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${summonProbeCode}),0,LOCATION_HAND,0,nil)
    Debug.Message("sea horse can special ${label} " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,probe)))
    Debug.Message("sea horse special ${label} " .. Duel.SpecialSummon(probe,0,0,0,false,false,POS_FACEUP_ATTACK))
    `,
    `thunder-sea-horse-${label.replace(/\\s+/g, "-")}-probe.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toEqual(expect.arrayContaining(expected));
}
