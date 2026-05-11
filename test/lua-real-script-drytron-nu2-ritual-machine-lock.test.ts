import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeRitual } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const raceMachine = 0x20;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Drytron Nu II Ritual Machine lock", () => {
  it("restores its Ritual Summon lock for non-Machine monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const drytronCode = "22435424";
    const machineRitualCode = "900000481";
    const dragonRitualCode = "900000482";
    const regularCode = "900000483";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === drytronCode),
      { code: machineRitualCode, name: "Drytron Nu II Machine Ritual Probe", kind: "monster", typeFlags: 0x81, race: raceMachine, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: dragonRitualCode, name: "Drytron Nu II Dragon Ritual Probe", kind: "monster", typeFlags: 0x81, race: raceDragon, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: regularCode, name: "Drytron Nu II Regular Special Probe", kind: "monster", typeFlags: 0x1, race: raceDragon, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 224, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [drytronCode, machineRitualCode, dragonRitualCode, regularCode] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [drytronCode, machineRitualCode, dragonRitualCode, regularCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(drytronCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${drytronCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${drytronCode}.cost(e,0,nil,0,0,nil,0,0,1)
      `,
      "drytron-nu2-official-cost.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:ritual-summon-not-race:${raceMachine}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local machine_ritual=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machineRitualCode}),0,LOCATION_HAND,0,nil)
      local dragon_ritual=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonRitualCode}),0,LOCATION_HAND,0,nil)
      local regular=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regularCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("drytron machine ritual special " .. Duel.SpecialSummon(machine_ritual,SUMMON_TYPE_RITUAL,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("drytron dragon ritual special " .. Duel.SpecialSummon(dragon_ritual,SUMMON_TYPE_RITUAL,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("drytron dragon regular special " .. Duel.SpecialSummon(regular,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "drytron-nu2-ritual-machine-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "drytron machine ritual special 1",
        "drytron dragon ritual special 0",
        "drytron dragon regular special 1",
      ]),
    );

    const lock = restored.session.state.effects.find((effect) => effect.code === 22);
    const dragonRitual = restored.session.state.cards.find((card) => card.code === dragonRitualCode);
    expect(lock?.targetCardPredicate?.({ duel: restored.session.state, summonTypeCode: luaSummonTypeRitual } as never, dragonRitual!)).toBe(true);
    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
