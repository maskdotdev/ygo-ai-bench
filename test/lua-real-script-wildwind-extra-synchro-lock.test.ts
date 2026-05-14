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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wildwind Extra Deck Synchro lock", () => {
  it("restores its temporary Extra Deck-only non-Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wildwindCode = "52589809";
    const synchroCode = "900000284";
    const fusionCode = "900000285";
    const handCode = "900000286";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wildwindCode),
      { code: synchroCode, name: "Wildwind Synchro Probe", kind: "monster", typeFlags: 0x2001, level: 4, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Wildwind Fusion Probe", kind: "monster", typeFlags: 0x41, level: 4, attack: 1000, defense: 1000 },
      { code: handCode, name: "Wildwind Hand Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wildwindCode, handCode], extra: [synchroCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const wildwind = session.state.cards.find((card) => card.code === wildwindCode);
    const handProbe = session.state.cards.find((card) => card.code === handCode);
    expect(wildwind).toBeDefined();
    expect(handProbe).toBeDefined();
    moveDuelCard(session.state, wildwind!.uid, "hand", 0);
    moveDuelCard(session.state, handProbe!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wildwindCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const applyLock = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wildwindCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${wildwindCode}.spop(e,0,nil,0,0,nil,0,0,c)
      `,
      "wildwind-official-spop.lua",
    );
    expect(applyLock.ok, applyLock.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("wildwind fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("wildwind hand special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("wildwind synchro special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "wildwind-extra-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    const messages = restored.host.messages.join("\n");
    expect(messages).toContain("wildwind fusion special 0");
    expect(messages).toContain("wildwind hand special 1");
    expect(messages).toContain("wildwind synchro special 1");

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
