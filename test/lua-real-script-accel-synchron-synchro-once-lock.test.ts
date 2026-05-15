import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeSynchro } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Accel Synchron Synchro once lock", () => {
  it("restores its same-code Synchro Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const accelCode = "37675907";
    const otherSynchroCode = "37675908";
    const fusionCode = "37675909";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === accelCode),
      { code: otherSynchroCode, name: "Accel Synchron Other Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 5, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Accel Synchron Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 5, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 376, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [accelCode, otherSynchroCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(accelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${accelCode}),0,LOCATION_EXTRA,0,nil)
      local e=Effect.CreateEffect(c)
      c${accelCode}.regop(e,0,nil,0,0,nil,0,0)
      `,
      "accel-synchron-official-synchro-once-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:summon-type-code:${luaSummonTypeSynchro}:${accelCode}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local accel=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${accelCode}),0,LOCATION_EXTRA,0,nil)
      local other_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${otherSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("accel synchro special " .. Duel.SpecialSummon(accel,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("accel fusion special " .. Duel.SpecialSummon(accel,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("other synchro special " .. Duel.SpecialSummon(other_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fusion synchro special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "accel-synchron-synchro-once-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "accel synchro special 0",
        "accel fusion special 1",
        "other synchro special 1",
        "fusion synchro special 1",
      ]),
    );
  });
});
