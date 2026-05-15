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
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Couplet Pendulum LIGHT lock", () => {
  it("restores its Pendulum Summon lock for non-LIGHT monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coupletCode = "90276649";
    const lightPendulumCode = "900000511";
    const darkPendulumCode = "900000512";
    const regularCode = "900000513";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coupletCode),
      { code: lightPendulumCode, name: "Couplet LIGHT Pendulum Probe", kind: "monster", typeFlags: pendulumType, race: 0x400, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
      { code: darkPendulumCode, name: "Couplet DARK Pendulum Probe", kind: "monster", typeFlags: pendulumType, race: 0x400, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
      { code: regularCode, name: "Couplet DARK Regular Special Probe", kind: "monster", typeFlags: 0x1, race: 0x400, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 902, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coupletCode, lightPendulumCode, darkPendulumCode, regularCode] }, 1: { main: [] } });
    startDuel(session);
    const couplet = session.state.cards.find((card) => card.code === coupletCode);
    expect(couplet).toBeDefined();
    moveDuelCard(session.state, couplet!.uid, "spellTrapZone", 0).sequence = 0;
    for (const code of [lightPendulumCode, darkPendulumCode, regularCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(coupletCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:pendulum-summon-not-attribute:${attributeLight}`,
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
      local light_pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightPendulumCode}),0,LOCATION_HAND,0,nil)
      local dark_pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkPendulumCode}),0,LOCATION_HAND,0,nil)
      local regular=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regularCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("couplet light pendulum special " .. Duel.SpecialSummon(light_pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("couplet dark pendulum special " .. Duel.SpecialSummon(dark_pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("couplet dark regular special " .. Duel.SpecialSummon(regular,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "couplet-pendulum-light-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "couplet light pendulum special 1",
        "couplet dark pendulum special 0",
        "couplet dark regular special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
