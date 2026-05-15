import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeFusion, luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fallen Angel fusion alternate once lock", () => {
  it("restores its same-code Fusion or alternate-procedure summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fallenAngelCode = "43143567";
    const otherFusionCode = "43143568";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fallenAngelCode),
      { code: otherFusionCode, name: "Fallen Angel Other Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 431, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [fallenAngelCode, otherFusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fallenAngelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fallenAngelCode}),0,LOCATION_EXTRA,0,nil)
      local e=Effect.CreateEffect(c)
      c${fallenAngelCode}.regop(e,0,nil,0,0,nil,0,0)
      `,
      "fallen-angel-official-fusion-alternate-once-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:summon-type-code-any:current:${luaSummonTypeFusion},${luaSummonTypeSpecial + 1}:${fallenAngelCode}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local fallen=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fallenAngelCode}),0,LOCATION_EXTRA,0,nil)
      local other_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${otherFusionCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("fallen fusion special " .. Duel.SpecialSummon(fallen,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fallen alternate special " .. Duel.SpecialSummon(fallen,SUMMON_TYPE_SPECIAL+1,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("other fusion special " .. Duel.SpecialSummon(other_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "fallen-angel-fusion-alternate-once-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "fallen fusion special 0",
        "fallen alternate special 0",
        "other fusion special 1",
      ]),
    );
  });
});
