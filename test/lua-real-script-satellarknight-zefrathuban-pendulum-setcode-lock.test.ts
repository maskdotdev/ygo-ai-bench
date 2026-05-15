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
const setTellarknight = 0x9c;
const setZefra = 0xc4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Satellarknight Zefrathuban Pendulum setcode lock", () => {
  it("restores its Pendulum Summon lock for non-tellarknight and non-Zefra monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zefrathubanCode = "96223501";
    const tellarknightCode = "900000471";
    const zefraCode = "900000472";
    const genericCode = "900000473";
    const regularCode = "900000474";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zefrathubanCode),
      { code: tellarknightCode, name: "Zefrathuban Tellarknight Probe", kind: "monster", typeFlags: pendulumType, setcodes: [setTellarknight], race: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: zefraCode, name: "Zefrathuban Zefra Probe", kind: "monster", typeFlags: pendulumType, setcodes: [setZefra], race: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: genericCode, name: "Zefrathuban Generic Pendulum Probe", kind: "monster", typeFlags: pendulumType, race: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: regularCode, name: "Zefrathuban Regular Special Probe", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 962, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zefrathubanCode, tellarknightCode, zefraCode, genericCode, regularCode] }, 1: { main: [] } });
    startDuel(session);
    const zefrathuban = session.state.cards.find((card) => card.code === zefrathubanCode);
    expect(zefrathuban).toBeDefined();
    moveDuelCard(session.state, zefrathuban!.uid, "spellTrapZone", 0).sequence = 0;
    for (const code of [tellarknightCode, zefraCode, genericCode, regularCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zefrathubanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:pendulum-summon-not-setcode:${setTellarknight},${setZefra}`,
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
      local tellarknight=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${tellarknightCode}),0,LOCATION_HAND,0,nil)
      local zefra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${zefraCode}),0,LOCATION_HAND,0,nil)
      local generic=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${genericCode}),0,LOCATION_HAND,0,nil)
      local regular=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regularCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("zefrathuban tellarknight pendulum special " .. Duel.SpecialSummon(tellarknight,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("zefrathuban zefra pendulum special " .. Duel.SpecialSummon(zefra,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("zefrathuban generic pendulum special " .. Duel.SpecialSummon(generic,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("zefrathuban regular special " .. Duel.SpecialSummon(regular,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "satellarknight-zefrathuban-pendulum-setcode-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "zefrathuban tellarknight pendulum special 1",
        "zefrathuban zefra pendulum special 1",
        "zefrathuban generic pendulum special 0",
        "zefrathuban regular special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
