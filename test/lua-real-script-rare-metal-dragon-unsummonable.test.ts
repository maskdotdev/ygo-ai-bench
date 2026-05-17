import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rare Metal Dragon unsummonable procedure", () => {
  it("restores EnableUnsummonable as revive limit plus Normal Summon and Set locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rareMetalDragonCode = "25236056";
    const normalMonsterCode = "25236057";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rareMetalDragonCode),
      { code: normalMonsterCode, name: "Unsummonable Comparator", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2523, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rareMetalDragonCode, normalMonsterCode] }, 1: { main: [] } });
    startDuel(session);

    const rareMetalDragon = session.state.cards.find((card) => card.code === rareMetalDragonCode);
    const normalMonster = session.state.cards.find((card) => card.code === normalMonsterCode);
    expect(rareMetalDragon).toBeDefined();
    expect(normalMonster).toBeDefined();
    moveDuelCard(session.state, rareMetalDragon!.uid, "hand", 0);
    moveDuelCard(session.state, normalMonster!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rareMetalDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    expect(effectCodesFor(restored.session, rareMetalDragon!.uid)).toEqual([20, 23, 31]);
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasCardAction(actions, "normalSummon", rareMetalDragon!.uid)).toBe(false);
    expect(hasCardAction(actions, "setMonster", rareMetalDragon!.uid)).toBe(false);
    expect(hasCardAction(actions, "normalSummon", normalMonster!.uid)).toBe(true);
    expect(hasCardAction(actions, "setMonster", normalMonster!.uid)).toBe(true);

    const probe = restored.host.loadScript(
      `
      local rare=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rareMetalDragonCode}),0,LOCATION_HAND,0,nil)
      local normal=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${normalMonsterCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("rare metal summon predicates " .. tostring(Duel.IsPlayerCanSummon(0,rare)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0,rare)))
      Debug.Message("normal summon predicates " .. tostring(Duel.IsPlayerCanSummon(0,normal)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0,normal)))
      `,
      "rare-metal-dragon-unsummonable-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual([
      "rare metal summon predicates false/false",
      "normal summon predicates true/true",
    ]);
  });
});

function effectCodesFor(session: DuelSession, uid: string): number[] {
  return session.state.effects
    .filter((effect) => effect.sourceUid === uid)
    .map((effect) => effect.code)
    .filter((code): code is number => code !== undefined)
    .sort((a, b) => a - b);
}

function hasCardAction(actions: DuelAction[], type: "normalSummon" | "setMonster", uid: string): boolean {
  return actions.some((action) => action.type === type && action.uid === uid);
}
