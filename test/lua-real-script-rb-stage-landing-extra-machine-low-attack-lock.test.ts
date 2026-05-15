import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script R.B. Stage Landing Extra Machine low-ATK lock", () => {
  it("restores its Extra Deck-only Machine 1500-or-less base ATK special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const stageLandingCode = "5109321";
    const lowMachineCode = "900000401";
    const highMachineCode = "900000402";
    const lowDragonCode = "900000403";
    const deckCode = "900000404";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === stageLandingCode),
      { code: lowMachineCode, name: "R.B. Stage Landing Low Machine Probe", kind: "extra", typeFlags: 0x4000001, race: 0x20, attribute: 0x10, level: 2, attack: 1500, defense: 0 },
      { code: highMachineCode, name: "R.B. Stage Landing High Machine Probe", kind: "extra", typeFlags: 0x4000001, race: 0x20, attribute: 0x10, level: 2, attack: 1600, defense: 0 },
      { code: lowDragonCode, name: "R.B. Stage Landing Low Dragon Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 2, attack: 1500, defense: 0 },
      { code: deckCode, name: "R.B. Stage Landing Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x20, attribute: 0x10, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 510, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [stageLandingCode, deckCode], extra: [lowMachineCode, highMachineCode, lowDragonCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(stageLandingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${stageLandingCode}),0,LOCATION_DECK,0,nil)
      local e=Effect.CreateEffect(c)
      c${stageLandingCode}.spcost(e,0,nil,0,0,nil,0,0,1)
      `,
      "rb-stage-landing-official-spcost.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-race-base-attack-lte-extra:32:1500",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const probe = restored.host.loadScript(
      `
      local low_machine=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowMachineCode}),0,LOCATION_EXTRA,0,nil)
      local high_machine=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highMachineCode}),0,LOCATION_EXTRA,0,nil)
      local low_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowDragonCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("rb stage high machine special " .. Duel.SpecialSummon(high_machine,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rb stage low dragon special " .. Duel.SpecialSummon(low_dragon,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rb stage low machine special " .. Duel.SpecialSummon(low_machine,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rb stage deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "rb-stage-landing-extra-machine-low-attack-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "rb stage high machine special 0",
        "rb stage low dragon special 0",
        "rb stage low machine special 1",
        "rb stage deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
