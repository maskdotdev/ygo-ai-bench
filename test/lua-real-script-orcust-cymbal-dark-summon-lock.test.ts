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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Orcust Cymbal Skeleton DARK summon lock", () => {
  it("restores its DARK-only special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cymbalCode = "21441617";
    const darkCode = "21441618";
    const lightCode = "21441619";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cymbalCode),
      { code: darkCode, name: "Orcust Cymbal DARK Probe", kind: "monster", typeFlags: 0x1, race: 0x20, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: lightCode, name: "Orcust Cymbal LIGHT Probe", kind: "monster", typeFlags: 0x1, race: 0x20, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 214, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cymbalCode, darkCode, lightCode], extra: [] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [cymbalCode, darkCode, lightCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cymbalCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${cymbalCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${cymbalCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "orcust-cymbal-official-dark-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:not-attribute:32",
      property: 0x4000800,
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      property: 0x4000800,
      targetRange: [1, 0],
    });
    const probe = restored.host.loadScript(
      `
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkCode}),0,LOCATION_HAND,0,nil)
      local light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("orcust dark special " .. Duel.SpecialSummon(dark,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("orcust light special " .. Duel.SpecialSummon(light,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "orcust-cymbal-dark-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages.slice(-2)).toEqual(["orcust dark special 1", "orcust light special 0"]);

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
