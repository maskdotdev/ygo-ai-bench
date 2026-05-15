import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Necro Vulture Rank-Up-Magic Xyz lock", () => {
  it("restores its related-effect Rank-Up-Magic Xyz special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const necroVultureCode = "51814159";
    const xyzCode = "523";
    const rumCode = "524";
    const offSetSpellCode = "525";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === necroVultureCode),
      { code: xyzCode, name: "Necro Vulture Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: rumCode, name: "Necro Vulture Rank-Up-Magic Probe", kind: "spell", typeFlags: 0x2, setcodes: [0x95] },
      { code: offSetSpellCode, name: "Necro Vulture Off-Set Spell Probe", kind: "spell", typeFlags: 0x2, setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 518, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [necroVultureCode, rumCode, offSetSpellCode], extra: [xyzCode] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [necroVultureCode, rumCode, offSetSpellCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(necroVultureCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${necroVultureCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${necroVultureCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "necro-vulture-official-rum-xyz-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:xyz-summon-not-related-setcode:149",
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
    const related = restored.host.loadScript(
      `
      local rum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rumCode}),0,LOCATION_HAND,0,nil)
      local off_set=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${offSetSpellCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(rum)
      e1:SetType(EFFECT_TYPE_ACTIVATE)
      e1:SetCode(EVENT_FREE_CHAIN)
      rum:RegisterEffect(e1)
      local e2=Effect.CreateEffect(off_set)
      e2:SetType(EFFECT_TYPE_ACTIVATE)
      e2:SetCode(EVENT_FREE_CHAIN)
      off_set:RegisterEffect(e2)
      `,
      "necro-vulture-related-effects.lua",
    );
    expect(related.ok, related.error).toBe(true);
    const xyz = restored.session.state.cards.find((card) => card.code === xyzCode);
    const rum = restored.session.state.cards.find((card) => card.code === rumCode);
    const offSet = restored.session.state.cards.find((card) => card.code === offSetSpellCode);
    const rumEffectId = restored.session.state.effects.find((effect) => effect.sourceUid === rum?.uid && effect.id.startsWith("lua-"))?.id;
    const offSetEffectId = restored.session.state.effects.find((effect) => effect.sourceUid === offSet?.uid && effect.id.startsWith("lua-"))?.id;
    expect(xyz).toBeDefined();
    expect(rumEffectId).toBeDefined();
    expect(offSetEffectId).toBeDefined();
    const lock = restored.session.state.effects.find((effect) => effect.code === 22);
    expect(lock).toMatchObject({ property: 0x4000800, targetRange: [1, 0] });
    expect(lock?.targetCardPredicate?.(targetContext(restored.session.state, luaBaseEffectId(offSetEffectId!)), xyz!)).toBe(true);
    expect(lock?.targetCardPredicate?.(targetContext(restored.session.state, luaBaseEffectId(rumEffectId!)), xyz!)).toBe(false);
  });
});

function targetContext(duel: ReturnType<typeof createDuel>["state"], relatedEffectId: number): never {
  return { duel, source: duel.cards[0]!, player: 0 as const, targetUids: [], log() {}, summonTypeCode: luaSummonTypeXyz, relatedEffectId } as never;
}

function luaBaseEffectId(effectId: string): number {
  const id = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  expect(Number.isFinite(id)).toBe(true);
  return id;
}
