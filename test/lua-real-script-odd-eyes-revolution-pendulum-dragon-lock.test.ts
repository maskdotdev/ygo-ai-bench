import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const pendulumType = 0x1000001;
const raceDragon = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Odd-Eyes Revolution Pendulum Dragon lock", () => {
  it("restores its Pendulum Summon lock for non-Dragon monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const revolutionCode = "16306932";
    const dragonPendulumCode = "900000521";
    const warriorPendulumCode = "900000522";
    const regularCode = "900000523";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === revolutionCode),
      { code: dragonPendulumCode, name: "Odd-Eyes Revolution Dragon Pendulum Probe", kind: "monster", typeFlags: pendulumType, race: raceDragon, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: warriorPendulumCode, name: "Odd-Eyes Revolution Warrior Pendulum Probe", kind: "monster", typeFlags: pendulumType, race: raceWarrior, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: regularCode, name: "Odd-Eyes Revolution Warrior Regular Probe", kind: "monster", typeFlags: 0x1, race: raceWarrior, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 163, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [revolutionCode, dragonPendulumCode, warriorPendulumCode, regularCode] }, 1: { main: [] } });
    startDuel(session);
    const revolution = session.state.cards.find((card) => card.code === revolutionCode);
    expect(revolution).toBeDefined();
    moveDuelCard(session.state, revolution!.uid, "spellTrapZone", 0).sequence = 0;
    for (const code of [dragonPendulumCode, warriorPendulumCode, regularCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(revolutionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:pendulum-summon-not-race:${raceDragon}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local dragon_pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonPendulumCode}),0,LOCATION_HAND,0,nil)
      local warrior_pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorPendulumCode}),0,LOCATION_HAND,0,nil)
      local regular=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regularCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("revolution dragon pendulum special " .. Duel.SpecialSummon(dragon_pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("revolution warrior pendulum special " .. Duel.SpecialSummon(warrior_pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("revolution warrior regular special " .. Duel.SpecialSummon(regular,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "odd-eyes-revolution-pendulum-dragon-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "revolution dragon pendulum special 1",
        "revolution warrior pendulum special 0",
        "revolution warrior regular special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
