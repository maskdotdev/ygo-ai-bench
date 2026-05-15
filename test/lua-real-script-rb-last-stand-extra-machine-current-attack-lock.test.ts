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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script R.B. Last Stand Extra Machine current-ATK lock", () => {
  it("restores its Extra Deck-only Machine 1500-or-less current ATK special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lastStandCode = "43450363";
    const lowMachineCode = "900000411";
    const highMachineCode = "900000412";
    const lowDragonCode = "900000413";
    const deckCode = "900000414";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lastStandCode),
      { code: lowMachineCode, name: "R.B. Last Stand Low Machine Probe", kind: "extra", typeFlags: 0x4000001, race: 0x20, attribute: 0x10, level: 2, attack: 1500, defense: 0 },
      { code: highMachineCode, name: "R.B. Last Stand High Machine Probe", kind: "extra", typeFlags: 0x4000001, race: 0x20, attribute: 0x10, level: 2, attack: 1600, defense: 0 },
      { code: lowDragonCode, name: "R.B. Last Stand Low Dragon Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 2, attack: 1500, defense: 0 },
      { code: deckCode, name: "R.B. Last Stand Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x20, attribute: 0x10, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 434, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lastStandCode, deckCode], extra: [lowMachineCode, highMachineCode, lowDragonCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lastStandCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lastStandCode}),0,LOCATION_DECK,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      c${lastStandCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "rb-last-stand-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-race-attack-lte-extra:32:1500",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const probe = restored.host.loadScript(
      `
      local low_machine=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowMachineCode}),0,LOCATION_EXTRA,0,nil)
      local high_machine=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highMachineCode}),0,LOCATION_EXTRA,0,nil)
      local low_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowDragonCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("rb last high machine special " .. Duel.SpecialSummon(high_machine,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rb last low dragon special " .. Duel.SpecialSummon(low_dragon,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rb last low machine special " .. Duel.SpecialSummon(low_machine,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rb last deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "rb-last-stand-extra-machine-current-attack-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "rb last high machine special 0",
        "rb last low dragon special 0",
        "rb last low machine special 1",
        "rb last deck special 1",
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
