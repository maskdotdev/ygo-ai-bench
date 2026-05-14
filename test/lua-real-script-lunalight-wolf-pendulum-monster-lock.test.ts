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
const pendulumType = 0x1000001;
const setLunalight = 0xdf;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lunalight Wolf Pendulum monster lock", () => {
  it("restores its Pendulum Summon lock for non-Lunalight monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wolfCode = "47705572";
    const lunalightCode = "900000531";
    const genericPendulumCode = "900000532";
    const regularCode = "900000533";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wolfCode),
      { code: lunalightCode, name: "Lunalight Wolf Lunalight Probe", kind: "monster", typeFlags: pendulumType, setcodes: [setLunalight], race: 0x400, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: genericPendulumCode, name: "Lunalight Wolf Generic Pendulum Probe", kind: "monster", typeFlags: pendulumType, race: 0x400, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: regularCode, name: "Lunalight Wolf Regular Special Probe", kind: "monster", typeFlags: 0x1, race: 0x400, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 477, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wolfCode, lunalightCode, genericPendulumCode, regularCode] }, 1: { main: [] } });
    startDuel(session);
    const wolf = session.state.cards.find((card) => card.code === wolfCode);
    expect(wolf).toBeDefined();
    moveDuelCard(session.state, wolf!.uid, "spellTrapZone", 0).sequence = 0;
    for (const code of [lunalightCode, genericPendulumCode, regularCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wolfCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:pendulum-summon-not-setcode-monster:${setLunalight}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local lunalight=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lunalightCode}),0,LOCATION_HAND,0,nil)
      local generic_pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${genericPendulumCode}),0,LOCATION_HAND,0,nil)
      local regular=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regularCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("wolf lunalight pendulum special " .. Duel.SpecialSummon(lunalight,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("wolf generic pendulum special " .. Duel.SpecialSummon(generic_pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("wolf regular special " .. Duel.SpecialSummon(regular,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "lunalight-wolf-pendulum-monster-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "wolf lunalight pendulum special 1",
        "wolf generic pendulum special 0",
        "wolf regular special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
