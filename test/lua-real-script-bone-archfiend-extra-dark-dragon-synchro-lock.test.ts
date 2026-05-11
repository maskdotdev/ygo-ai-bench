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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Bone Archfiend Extra DARK Dragon Synchro lock", () => {
  it("restores its Type-then-Race-then-Attribute Extra Deck-only DARK Dragon Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const boneCode = "25784595";
    const allowedCode = "900000336";
    const lightDragonSynchroCode = "900000337";
    const darkFiendSynchroCode = "900000338";
    const darkDragonFusionCode = "900000339";
    const handLightCode = "900000340";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === boneCode),
      { code: allowedCode, name: "Bone DARK Dragon Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: lightDragonSynchroCode, name: "Bone LIGHT Dragon Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: darkFiendSynchroCode, name: "Bone DARK Fiend Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: darkDragonFusionCode, name: "Bone DARK Dragon Fusion Probe", kind: "monster", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handLightCode, name: "Bone Hand LIGHT Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 257, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [boneCode, handLightCode], extra: [allowedCode, lightDragonSynchroCode, darkFiendSynchroCode, darkDragonFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const bone = session.state.cards.find((card) => card.code === boneCode);
    const handLight = session.state.cards.find((card) => card.code === handLightCode);
    expect(bone).toBeDefined();
    expect(handLight).toBeDefined();
    moveDuelCard(session.state, bone!.uid, "hand", 0);
    moveDuelCard(session.state, handLight!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(boneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${boneCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${boneCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "bone-archfiend-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local allowed=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${allowedCode}),0,LOCATION_EXTRA,0,nil)
      local light_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightDragonSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_fiend=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkFiendSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_dragon_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkDragonFusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand_light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handLightCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("bone light dragon synchro special " .. Duel.SpecialSummon(light_dragon,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("bone dark fiend synchro special " .. Duel.SpecialSummon(dark_fiend,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("bone dark dragon fusion special " .. Duel.SpecialSummon(dark_dragon_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("bone dark dragon synchro special " .. Duel.SpecialSummon(allowed,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("bone hand light special " .. Duel.SpecialSummon(hand_light,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "bone-archfiend-extra-dark-dragon-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "bone light dragon synchro special 0",
        "bone dark fiend synchro special 0",
        "bone dark dragon fusion special 0",
        "bone dark dragon synchro special 1",
        "bone hand light special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
