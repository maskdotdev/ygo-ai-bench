import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wildwind Lizard original Synchro lock", () => {
  it("restores its original-type Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wildwindCode = "52589809";
    const synchroCode = "52589810";
    const fusionCode = "52589811";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wildwindCode),
      { code: synchroCode, name: "Wildwind Original Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x8, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Wildwind Original Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x8, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wildwindCode], extra: [synchroCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wildwindCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wildwindCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${wildwindCode}.lizfilter)
      `,
      "wildwind-official-lizard-check.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type:8192",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type:8192",
      value: 1,
    });
    const mutateTypes = restored.host.loadScript(
      `
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local es=Effect.CreateEffect(synchro)
      es:SetType(EFFECT_TYPE_SINGLE)
      es:SetCode(EFFECT_CHANGE_TYPE)
      es:SetValue(TYPE_MONSTER|TYPE_FUSION)
      synchro:RegisterEffect(es)
      local ef=Effect.CreateEffect(fusion)
      ef:SetType(EFFECT_TYPE_SINGLE)
      ef:SetCode(EFFECT_CHANGE_TYPE)
      ef:SetValue(TYPE_MONSTER|TYPE_SYNCHRO)
      fusion:RegisterEffect(ef)
      `,
      "wildwind-lizard-current-type-mutation.lua",
    );
    expect(mutateTypes.ok, mutateTypes.error).toBe(true);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 51476410);
    const restoredWildwind = restored.session.state.cards.find((card) => card.code === wildwindCode);
    const restoredSynchro = restored.session.state.cards.find((card) => card.code === synchroCode);
    const restoredFusion = restored.session.state.cards.find((card) => card.code === fusionCode);
    expect(restoredEffect?.targetCardPredicate).toBeDefined();
    expect(restoredWildwind).toBeDefined();
    expect(restoredSynchro).toBeDefined();
    expect(restoredFusion).toBeDefined();
    const ctx: DuelEffectContext = {
      duel: restored.session.state,
      source: restoredWildwind!,
      player: 0,
      targetUids: [],
      log: () => {},
      moveCard: () => restoredWildwind!,
      negateChainLink: () => false,
      setTargets: () => {},
      getTargets: () => [],
      setTargetPlayer: () => {},
      setTargetParam: () => {},
    };
    expect(restoredEffect!.targetCardPredicate!(ctx, restoredSynchro!)).toBe(false);
    expect(restoredEffect!.targetCardPredicate!(ctx, restoredFusion!)).toBe(true);
  });
});
