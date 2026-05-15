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
import { luaSummonTypePendulum } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Odd-Eyes Phantasma Dragon Pendulum summon lock", () => {
  it("restores its Pendulum summon-type special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const phantasmaCode = "21770839";
    const pendulumCode = "900000461";
    const specialCode = "900000462";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === phantasmaCode),
      { code: pendulumCode, name: "Odd-Eyes Phantasma Pendulum Probe", kind: "monster", typeFlags: 0x1000001, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: specialCode, name: "Odd-Eyes Phantasma Special Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 217, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [phantasmaCode, pendulumCode, specialCode] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [phantasmaCode, pendulumCode, specialCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(phantasmaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${phantasmaCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetTarget(c${phantasmaCode}.splimit)
      e1:SetTargetRange(1,0)
      Duel.RegisterEffect(e1,0)
      `,
      "odd-eyes-phantasma-official-pendulum-summon-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:special-summon-type-is:${luaSummonTypePendulum}`,
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
      local pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${pendulumCode}),0,LOCATION_HAND,0,nil)
      local special=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${specialCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("phantasma pendulum special " .. Duel.SpecialSummon(pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("phantasma regular special " .. Duel.SpecialSummon(special,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "odd-eyes-phantasma-pendulum-summon-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "phantasma pendulum special 0",
        "phantasma regular special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
