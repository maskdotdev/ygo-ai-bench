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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Link Turret Extra DARK Link lock", () => {
  it("restores its IsLinkMonster-based Extra Deck-only DARK Link special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const linkTurretCode = "55034079";
    const darkLinkCode = "900000361";
    const lightLinkCode = "900000362";
    const darkFusionCode = "900000363";
    const handCode = "900000364";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === linkTurretCode),
      { code: darkLinkCode, name: "Link Turret DARK Link Probe", kind: "extra", typeFlags: 0x4000001, attribute: 0x20, level: 0, attack: 1000, defense: 0 },
      { code: lightLinkCode, name: "Link Turret LIGHT Link Probe", kind: "extra", typeFlags: 0x4000001, attribute: 0x10, level: 0, attack: 1000, defense: 0 },
      { code: darkFusionCode, name: "Link Turret DARK Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handCode, name: "Link Turret Hand Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 550, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [linkTurretCode, handCode], extra: [darkLinkCode, lightLinkCode, darkFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const linkTurret = session.state.cards.find((card) => card.code === linkTurretCode);
    expect(linkTurret).toBeDefined();
    moveDuelCard(session.state, linkTurret!.uid, "spellTrapZone", 0);
    linkTurret!.faceUp = true;
    session.state.phase = "main2";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(linkTurretCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${linkTurretCode}),0,LOCATION_SZONE,0,nil)
      c:AddCounter(0x48,1)
      local e=Effect.CreateEffect(c)
      c${linkTurretCode}.spcost(e,0,nil,0,0,nil,0,0,1)
      `,
      "link-turret-official-spcost.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local dark_link=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkLinkCode}),0,LOCATION_EXTRA,0,nil)
      local light_link=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightLinkCode}),0,LOCATION_EXTRA,0,nil)
      local dark_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkFusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("link turret light link special " .. Duel.SpecialSummon(light_link,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("link turret dark fusion special " .. Duel.SpecialSummon(dark_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("link turret dark link special " .. Duel.SpecialSummon(dark_link,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("link turret deck special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "link-turret-extra-dark-link-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "link turret light link special 0",
        "link turret dark fusion special 0",
        "link turret dark link special 1",
        "link turret deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
