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
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nebula Dragon LIGHT/DARK Dragon lock", () => {
  it("restores its LIGHT or DARK Dragon special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nebulaCode = "51786039";
    const lightDragonCode = "51786040";
    const darkDragonCode = "51786041";
    const fireDragonCode = "51786042";
    const lightWarriorCode = "51786043";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nebulaCode),
      { code: lightDragonCode, name: "Nebula LIGHT Dragon Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: darkDragonCode, name: "Nebula DARK Dragon Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: fireDragonCode, name: "Nebula FIRE Dragon Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x4, level: 8, attack: 1000, defense: 1000 },
      { code: lightWarriorCode, name: "Nebula LIGHT Warrior Probe", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 517, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nebulaCode, lightDragonCode, darkDragonCode, fireDragonCode, lightWarriorCode], extra: [] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [nebulaCode, lightDragonCode, darkDragonCode, fireDragonCode, lightWarriorCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nebulaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${nebulaCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${nebulaCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "nebula-dragon-official-light-dark-dragon-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:not-race-attribute:8192:48",
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
      local light_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightDragonCode}),0,LOCATION_HAND,0,nil)
      local dark_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkDragonCode}),0,LOCATION_HAND,0,nil)
      local fire_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fireDragonCode}),0,LOCATION_HAND,0,nil)
      local light_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightWarriorCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("nebula fire dragon special " .. Duel.SpecialSummon(fire_dragon,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("nebula light warrior special " .. Duel.SpecialSummon(light_warrior,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("nebula light dragon special " .. Duel.SpecialSummon(light_dragon,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("nebula dark dragon special " .. Duel.SpecialSummon(dark_dragon,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "nebula-dragon-light-dark-dragon-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "nebula fire dragon special 0",
        "nebula light warrior special 0",
        "nebula light dragon special 1",
        "nebula dark dragon special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
