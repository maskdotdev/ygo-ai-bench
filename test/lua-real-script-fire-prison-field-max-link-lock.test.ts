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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fire Prison field max Link lock", () => {
  it("restores its field max Link Rating summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const firePrisonCode = "269510";
    const fieldLink3Code = "269511";
    const link2Code = "269512";
    const link3Code = "269513";
    const link4Code = "269514";
    const fusionCode = "269515";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === firePrisonCode),
      { code: fieldLink3Code, name: "Fire Prison Field Link-3 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 3, attack: 1000, defense: 0 },
      { code: link2Code, name: "Fire Prison Link-2 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 2, attack: 1000, defense: 0 },
      { code: link3Code, name: "Fire Prison Link-3 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 3, attack: 1000, defense: 0 },
      { code: link4Code, name: "Fire Prison Link-4 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 0 },
      { code: fusionCode, name: "Fire Prison Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 269, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [firePrisonCode], extra: [fieldLink3Code, link2Code, link3Code, link4Code, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    const firePrison = session.state.cards.find((card) => card.code === firePrisonCode);
    const fieldLink3 = session.state.cards.find((card) => card.code === fieldLink3Code);
    expect(firePrison).toBeDefined();
    expect(fieldLink3).toBeDefined();
    moveDuelCard(session.state, firePrison!.uid, "spellTrapZone", 0).sequence = 4;
    firePrison!.faceUp = true;
    moveDuelCard(session.state, fieldLink3!.uid, "monsterZone", 0);
    fieldLink3!.faceUp = true;
    fieldLink3!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(firePrisonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:link-summon-below-field-max-link",
    });

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
      local link2=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link2Code}),0,LOCATION_EXTRA,0,nil)
      local link3=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link3Code}),0,LOCATION_EXTRA,0,nil)
      local link4=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link4Code}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("fire prison link2 link special " .. Duel.SpecialSummon(link2,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fire prison link3 link special " .. Duel.SpecialSummon(link3,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fire prison link4 link special " .. Duel.SpecialSummon(link4,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fire prison fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "fire-prison-field-max-link-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "fire prison link2 link special 0",
        "fire prison link3 link special 1",
        "fire prison link4 link special 1",
        "fire prison fusion special 1",
      ]),
    );
  });
});
