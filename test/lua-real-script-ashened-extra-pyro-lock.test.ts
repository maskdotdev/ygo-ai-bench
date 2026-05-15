import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ashened Extra Deck Pyro lock", () => {
  it("restores its temporary Extra Deck-only non-Pyro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ashenedCode = "98828338";
    const deckPyroCode = "900000290";
    const extraPyroCode = "900000291";
    const extraMachineCode = "900000292";
    const handMachineCode = "900000293";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ashenedCode),
      { code: deckPyroCode, name: "Ashened Deck Pyro Probe", kind: "monster", typeFlags: 0x1, race: 0x80, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: extraPyroCode, name: "Ashened Extra Pyro Probe", kind: "monster", typeFlags: 0x41, race: 0x80, level: 4, attack: 1000, defense: 1000 },
      { code: extraMachineCode, name: "Ashened Extra Machine Probe", kind: "monster", typeFlags: 0x41, race: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handMachineCode, name: "Ashened Hand Machine Probe", kind: "monster", typeFlags: 0x1, race: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 988, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ashenedCode, deckPyroCode, handMachineCode], extra: [extraPyroCode, extraMachineCode] }, 1: { main: [] } });
    startDuel(session);

    const ashened = session.state.cards.find((card) => card.code === ashenedCode);
    const handMachine = session.state.cards.find((card) => card.code === handMachineCode);
    expect(ashened).toBeDefined();
    expect(handMachine).toBeDefined();
    moveDuelCard(session.state, ashened!.uid, "hand", 0);
    moveDuelCard(session.state, handMachine!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ashenedCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ashenedCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      c${ashenedCode}.activate(e,0,nil,0,0,nil,0,0)
      `,
      "ashened-official-activate.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local pyro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${extraPyroCode}),0,LOCATION_EXTRA,0,nil)
      local machine=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${extraMachineCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handMachineCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("ashened extra machine special " .. Duel.SpecialSummon(machine,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("ashened hand machine special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("ashened extra pyro special " .. Duel.SpecialSummon(pyro,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "ashened-extra-pyro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["ashened extra machine special 0", "ashened hand machine special 1", "ashened extra pyro special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
