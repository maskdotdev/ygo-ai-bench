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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Token Collector token summon lock", () => {
  it("restores its token special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const collectorCode = "43534808";
    const tokenCode = "43534809";
    const handCode = "43534810";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === collectorCode),
      { code: tokenCode, name: "Token Collector Probe Token", kind: "monster", typeFlags: 0x4001, race: 0x2000, attribute: 0x10, level: 1, attack: 0, defense: 0 },
      { code: handCode, name: "Token Collector Hand Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 435, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [collectorCode, handCode], extra: [] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [collectorCode, handCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(collectorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${collectorCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e1:SetTargetRange(1,1)
      e1:SetTarget(c${collectorCode}.sumlimit)
      Duel.RegisterEffect(e1,0)
      `,
      "token-collector-official-token-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:type:16384",
      property: 0x800,
      targetRange: [1, 1],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(restored.session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      property: 0x800,
      targetRange: [1, 1],
    });
    const probe = restored.host.loadScript(
      `
      local token=Duel.CreateToken(0,${tokenCode})
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("token collector token special " .. Duel.SpecialSummon(token,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("token collector hand special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "token-collector-token-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages.slice(-2)).toEqual(["token collector token special 0", "token collector hand special 1"]);

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
