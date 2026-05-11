import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mirror Mage Extra WATER Synchro lock", () => {
  it("restores its temporary Extra Deck-only WATER Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mirrorMageCode = "9396662";
    const waterSynchroCode = "900000299";
    const darkSynchroCode = "900000300";
    const waterFusionCode = "900000301";
    const handDarkCode = "900000302";
    const blockers = ["900000303", "900000304", "900000305", "900000306"];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mirrorMageCode),
      { code: waterSynchroCode, name: "Mirror Mage WATER Synchro Probe", kind: "monster", typeFlags: 0x2001, attribute: 0x2, level: 4, attack: 1000, defense: 1000 },
      { code: darkSynchroCode, name: "Mirror Mage DARK Synchro Probe", kind: "monster", typeFlags: 0x2001, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: waterFusionCode, name: "Mirror Mage WATER Fusion Probe", kind: "monster", typeFlags: 0x41, attribute: 0x2, level: 4, attack: 1000, defense: 1000 },
      { code: handDarkCode, name: "Mirror Mage Hand DARK Probe", kind: "monster", typeFlags: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      ...blockers.map((code): DuelCardData => ({ code, name: `Mirror Mage Zone Blocker ${code}`, kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 939, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mirrorMageCode, handDarkCode, ...blockers], extra: [waterSynchroCode, darkSynchroCode, waterFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const mirrorMage = session.state.cards.find((card) => card.code === mirrorMageCode);
    const handDark = session.state.cards.find((card) => card.code === handDarkCode);
    expect(mirrorMage).toBeDefined();
    expect(handDark).toBeDefined();
    moveDuelCard(session.state, mirrorMage!.uid, "monsterZone", 0);
    mirrorMage!.position = "faceUpAttack";
    mirrorMage!.faceUp = true;
    for (const code of blockers) {
      const blocker = session.state.cards.find((card) => card.code === code);
      expect(blocker).toBeDefined();
      moveDuelCard(session.state, blocker!.uid, "monsterZone", 0);
    }
    moveDuelCard(session.state, handDark!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mirrorMageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${mirrorMageCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${mirrorMageCode}.tkop(e,0,nil,0,0,nil,0,0)
      `,
      "mirror-mage-official-tkop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    for (const code of blockers) {
      const blocker = session.state.cards.find((card) => card.code === code);
      moveDuelCard(session.state, blocker!.uid, "graveyard", 0);
    }

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local water_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${waterSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local water_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${waterFusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand_dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handDarkCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("mirror mage dark synchro special " .. Duel.SpecialSummon(dark_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("mirror mage water fusion special " .. Duel.SpecialSummon(water_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("mirror mage water synchro special " .. Duel.SpecialSummon(water_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("mirror mage hand dark special " .. Duel.SpecialSummon(hand_dark,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "mirror-mage-extra-water-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "mirror mage dark synchro special 0",
        "mirror mage water fusion special 0",
        "mirror mage water synchro special 1",
        "mirror mage hand dark special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
