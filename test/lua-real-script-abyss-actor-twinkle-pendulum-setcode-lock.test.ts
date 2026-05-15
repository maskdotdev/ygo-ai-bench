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
const pendulumType = 0x1000001;
const setAbyssActor = 0x10ec;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Abyss Actor Twinkle Little Star Pendulum setcode lock", () => {
  it("restores its single-setcode Pendulum Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const twinkleCode = "7279373";
    const abyssActorCode = "900000501";
    const genericPendulumCode = "900000502";
    const regularCode = "900000503";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === twinkleCode),
      { code: abyssActorCode, name: "Twinkle Little Star Abyss Actor Probe", kind: "monster", typeFlags: pendulumType, setcodes: [setAbyssActor], race: 0x400, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: genericPendulumCode, name: "Twinkle Little Star Generic Pendulum Probe", kind: "monster", typeFlags: pendulumType, race: 0x400, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: regularCode, name: "Twinkle Little Star Regular Special Probe", kind: "monster", typeFlags: 0x1, race: 0x400, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 727, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [twinkleCode, abyssActorCode, genericPendulumCode, regularCode] }, 1: { main: [] } });
    startDuel(session);
    const twinkle = session.state.cards.find((card) => card.code === twinkleCode);
    expect(twinkle).toBeDefined();
    moveDuelCard(session.state, twinkle!.uid, "spellTrapZone", 0).sequence = 0;
    for (const code of [abyssActorCode, genericPendulumCode, regularCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(twinkleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:pendulum-summon-not-setcode:${setAbyssActor}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local abyss_actor=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${abyssActorCode}),0,LOCATION_HAND,0,nil)
      local generic_pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${genericPendulumCode}),0,LOCATION_HAND,0,nil)
      local regular=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regularCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("twinkle abyss actor pendulum special " .. Duel.SpecialSummon(abyss_actor,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("twinkle generic pendulum special " .. Duel.SpecialSummon(generic_pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("twinkle regular special " .. Duel.SpecialSummon(regular,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "abyss-actor-twinkle-pendulum-setcode-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "twinkle abyss actor pendulum special 1",
        "twinkle generic pendulum special 0",
        "twinkle regular special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
