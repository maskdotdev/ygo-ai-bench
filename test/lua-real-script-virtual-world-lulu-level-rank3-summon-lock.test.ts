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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Virtual World Lulu Level/Rank 3 summon lock", () => {
  it("restores its Level or Rank 3+ special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const luluCode = "49088914";
    const level4Code = "49088915";
    const level2Code = "49088916";
    const rank3Code = "49088917";
    const link2Code = "49088918";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === luluCode),
      { code: level4Code, name: "Virtual World Lulu Level 4 Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: level2Code, name: "Virtual World Lulu Level 2 Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 2, attack: 1000, defense: 1000 },
      { code: rank3Code, name: "Virtual World Lulu Rank 3 Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x10, level: 3, attack: 1000, defense: 1000 },
      { code: link2Code, name: "Virtual World Lulu Link 2 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 2, attack: 1000, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 490, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [luluCode, level4Code, level2Code], extra: [rank3Code, link2Code] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [luluCode, level4Code, level2Code]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(luluCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${luluCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${luluCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "virtual-world-lulu-official-level-rank3-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:not-level-or-rank-above:3",
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      targetRange: [1, 0],
    });
    const probe = restored.host.loadScript(
      `
      local level4=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level4Code}),0,LOCATION_HAND,0,nil)
      local level2=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level2Code}),0,LOCATION_HAND,0,nil)
      local rank3=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank3Code}),0,LOCATION_EXTRA,0,nil)
      local link2=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link2Code}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("lulu level2 special " .. Duel.SpecialSummon(level2,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("lulu link2 special " .. Duel.SpecialSummon(link2,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("lulu level4 special " .. Duel.SpecialSummon(level4,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("lulu rank3 special " .. Duel.SpecialSummon(rank3,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "virtual-world-lulu-level-rank3-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "lulu level2 special 0",
        "lulu link2 special 0",
        "lulu level4 special 1",
        "lulu rank3 special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
