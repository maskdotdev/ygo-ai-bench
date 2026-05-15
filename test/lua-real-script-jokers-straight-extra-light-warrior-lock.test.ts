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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Joker's Straight Extra LIGHT Warrior lock", () => {
  it("restores its Extra Deck-only LIGHT Warrior special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const jokersStraightCode = "92067220";
    const queenKnightCode = "25652259";
    const kingKnightCode = "64788463";
    const jackKnightCode = "90876561";
    const discardCode = "900000331";
    const lightWarriorCode = "900000332";
    const darkWarriorCode = "900000333";
    const lightDragonCode = "900000334";
    const handDarkWarriorCode = "900000335";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [jokersStraightCode, queenKnightCode, kingKnightCode, jackKnightCode].includes(card.code)),
      { code: discardCode, name: "Joker's Straight Discard Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, race: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: lightWarriorCode, name: "Joker's Straight LIGHT Warrior Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, race: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: darkWarriorCode, name: "Joker's Straight DARK Warrior Probe", kind: "extra", typeFlags: 0x41, attribute: 0x20, race: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: lightDragonCode, name: "Joker's Straight LIGHT Dragon Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, race: 0x2000, level: 4, attack: 1000, defense: 1000 },
      { code: handDarkWarriorCode, name: "Joker's Straight Hand DARK Warrior Probe", kind: "monster", typeFlags: 0x21, attribute: 0x20, race: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 920, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jokersStraightCode, discardCode, queenKnightCode, kingKnightCode, jackKnightCode, handDarkWarriorCode], extra: [lightWarriorCode, darkWarriorCode, lightDragonCode] }, 1: { main: [] } });
    startDuel(session);

    for (const code of [jokersStraightCode, discardCode, handDarkWarriorCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jokersStraightCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${jokersStraightCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${jokersStraightCode}.activate(e,0,nil,0,0,nil,0,0)
      `,
      "jokers-straight-official-activate.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-attribute-race-extra:16:1",
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
      local light_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightWarriorCode}),0,LOCATION_EXTRA,0,nil)
      local dark_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkWarriorCode}),0,LOCATION_EXTRA,0,nil)
      local light_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightDragonCode}),0,LOCATION_EXTRA,0,nil)
      local hand_dark_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handDarkWarriorCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("jokers dark warrior special " .. Duel.SpecialSummon(dark_warrior,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("jokers light dragon special " .. Duel.SpecialSummon(light_dragon,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("jokers light warrior special " .. Duel.SpecialSummon(light_warrior,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("jokers hand dark warrior special " .. Duel.SpecialSummon(hand_dark_warrior,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "jokers-straight-extra-light-warrior-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "jokers dark warrior special 0",
        "jokers light dragon special 0",
        "jokers light warrior special 1",
        "jokers hand dark warrior special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
