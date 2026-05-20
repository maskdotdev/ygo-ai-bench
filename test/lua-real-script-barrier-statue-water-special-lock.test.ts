import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Barrier Statue WATER special summon lock", () => {
  it("restores its field EFFECT_CANNOT_SPECIAL_SUMMON and allows only WATER summons for both players", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const statueCode = "10963799";
    const waterCode = "900001099";
    const darkCode = "900001100";
    const opponentWaterCode = "900001101";
    const opponentDarkCode = "900001102";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === statueCode),
      { code: waterCode, name: "Barrier Statue WATER Probe", kind: "monster", typeFlags: 0x1, attribute: 0x2, level: 4, attack: 1000, defense: 1000 },
      { code: darkCode, name: "Barrier Statue DARK Probe", kind: "monster", typeFlags: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: opponentWaterCode, name: "Opponent Barrier Statue WATER Probe", kind: "monster", typeFlags: 0x1, attribute: 0x2, level: 4, attack: 1000, defense: 1000 },
      { code: opponentDarkCode, name: "Opponent Barrier Statue DARK Probe", kind: "monster", typeFlags: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 109, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [statueCode, waterCode, darkCode] }, 1: { main: [opponentWaterCode, opponentDarkCode] } });
    startDuel(session);

    const statue = session.state.cards.find((card) => card.code === statueCode);
    const water = session.state.cards.find((card) => card.code === waterCode);
    const dark = session.state.cards.find((card) => card.code === darkCode);
    const opponentWater = session.state.cards.find((card) => card.code === opponentWaterCode);
    const opponentDark = session.state.cards.find((card) => card.code === opponentDarkCode);
    expect(statue).toBeDefined();
    expect(water).toBeDefined();
    expect(dark).toBeDefined();
    expect(opponentWater).toBeDefined();
    expect(opponentDark).toBeDefined();
    moveDuelCard(session.state, statue!.uid, "monsterZone", 0);
    statue!.position = "faceUpAttack";
    statue!.faceUp = true;
    moveDuelCard(session.state, water!.uid, "hand", 0);
    moveDuelCard(session.state, dark!.uid, "hand", 0);
    moveDuelCard(session.state, opponentWater!.uid, "hand", 1);
    moveDuelCard(session.state, opponentDark!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(statueCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 22 && effect.sourceUid === statue!.uid)).toMatchObject({
      luaTargetDescriptor: "target:not-attribute:2",
      property: 0x800,
      range: ["monsterZone"],
      targetRange: [1, 1],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const probe = restored.host.loadScript(
      `
      local water=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${waterCode}),0,LOCATION_HAND,0,nil)
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkCode}),0,LOCATION_HAND,0,nil)
      local opponent_water=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${opponentWaterCode}),0,0,LOCATION_HAND,nil)
      local opponent_dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${opponentDarkCode}),0,0,LOCATION_HAND,nil)
      Debug.Message("barrier statue can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,water)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,dark)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(1,0,POS_FACEUP_ATTACK,1,opponent_water)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(1,0,POS_FACEUP_ATTACK,1,opponent_dark)))
      Debug.Message("barrier statue self special " .. Duel.SpecialSummon(dark,0,0,0,false,false,POS_FACEUP_ATTACK) .. "/" .. Duel.SpecialSummon(water,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("barrier statue opponent special " .. Duel.SpecialSummon(opponent_dark,0,1,1,false,false,POS_FACEUP_ATTACK) .. "/" .. Duel.SpecialSummon(opponent_water,0,1,1,false,false,POS_FACEUP_ATTACK))
      `,
      "barrier-statue-water-special-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("barrier statue can special true/false/true/false");
    expect(restored.host.messages).toContain("barrier statue self special 0/1");
    expect(restored.host.messages).toContain("barrier statue opponent special 0/1");
  });
});
