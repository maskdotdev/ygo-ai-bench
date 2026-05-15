import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kewl Tune Synchro Tuner special summon lock", () => {
  it("restores official temporary EFFECT_CANNOT_SPECIAL_SUMMON that allows only Tuners", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kewlTuneCode = "78058681";
    const searchCode = "16509007";
    const tunerCode = "900000280";
    const nonTunerCode = "900000281";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [kewlTuneCode, searchCode].includes(card.code)),
      { code: tunerCode, name: "Kewl Tune Tuner Probe", kind: "monster", typeFlags: 0x1001, level: 4, attack: 1000, defense: 1000 },
      { code: nonTunerCode, name: "Kewl Tune Non-Tuner Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 780, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kewlTuneCode, searchCode, tunerCode, nonTunerCode] }, 1: { main: [] } });
    startDuel(session);

    const kewlTune = session.state.cards.find((card) => card.code === kewlTuneCode);
    const tuner = session.state.cards.find((card) => card.code === tunerCode);
    const nonTuner = session.state.cards.find((card) => card.code === nonTunerCode);
    expect(kewlTune).toBeDefined();
    expect(tuner).toBeDefined();
    expect(nonTuner).toBeDefined();
    moveDuelCard(session.state, kewlTune!.uid, "hand", 0);
    moveDuelCard(session.state, tuner!.uid, "hand", 0);
    moveDuelCard(session.state, nonTuner!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kewlTuneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === kewlTune!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    resolveOpenChain(session);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local tuner=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${tunerCode}),0,LOCATION_HAND,0,nil)
      local non_tuner=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${nonTunerCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("kewl tune can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,tuner)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,non_tuner)))
      Debug.Message("kewl tune non-tuner special " .. Duel.SpecialSummon(non_tuner,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("kewl tune tuner special " .. Duel.SpecialSummon(tuner,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "kewl-tune-synchro-tuner-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("kewl tune can special true/false");
    expect(restored.host.messages).toContain("kewl tune non-tuner special 0");
    expect(restored.host.messages).toContain("kewl tune tuner special 1");
  });
});

function resolveOpenChain(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.chain.length > 0; index += 1) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
  expect(session.state.chain).toHaveLength(0);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  return response;
}
