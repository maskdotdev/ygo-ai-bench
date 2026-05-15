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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pendulum Area summon-type lock", () => {
  it("restores its non-Pendulum special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pendulumAreaCode = "2359348";
    const pendulumCode = "517";
    const genericCode = "518";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pendulumAreaCode),
      { code: pendulumCode, name: "Pendulum Area Pendulum Probe", kind: "monster", typeFlags: 0x1000001, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: genericCode, name: "Pendulum Area Generic Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 235, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pendulumAreaCode, pendulumCode, genericCode] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [pendulumAreaCode, pendulumCode, genericCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pendulumAreaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${pendulumAreaCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,1)
      e1:SetTarget(c${pendulumAreaCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "pendulum-area-official-splimit.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:special-summon-type-not:${luaSummonTypePendulum}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredLock = restored.session.state.effects.find((effect) => effect.code === 22);
    const pendulumProbe = restored.session.state.cards.find((card) => card.code === pendulumCode);
    expect(restoredLock?.targetCardPredicate?.({ summonTypeCode: luaSummonTypePendulum } as never, pendulumProbe!)).toBe(false);
    const probe = restored.host.loadScript(
      `
      local pendulum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${pendulumCode}),0,LOCATION_HAND,0,nil)
      local generic=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${genericCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("pendulum area generic special " .. Duel.SpecialSummon(generic,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("pendulum area pendulum special " .. Duel.SpecialSummon(pendulum,SUMMON_TYPE_PENDULUM,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "pendulum-area-summon-type-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "pendulum area generic special 0",
        "pendulum area pendulum special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
