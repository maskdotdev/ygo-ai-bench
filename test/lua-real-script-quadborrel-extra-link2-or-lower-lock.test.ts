import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Quadborrel Extra Link-2 or lower lock", () => {
  it("restores its Extra Deck-only Link-2 or lower special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const quadborrelCode = "29296344";
    const targetCode = "511";
    const link1Code = "512";
    const link2Code = "513";
    const link3Code = "514";
    const fusionCode = "515";
    const deckCode = "516";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === quadborrelCode),
      { code: targetCode, name: "Quadborrel Destroy Target Probe", kind: "monster", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 2, attack: 1000, defense: 1000 },
      { code: link1Code, name: "Quadborrel Link-1 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 1, attack: 1000, defense: 0 },
      { code: link2Code, name: "Quadborrel Link-2 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 2, attack: 1000, defense: 0 },
      { code: link3Code, name: "Quadborrel Link-3 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 3, attack: 1000, defense: 0 },
      { code: fusionCode, name: "Quadborrel Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Quadborrel Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 292, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [quadborrelCode, targetCode, deckCode], extra: [link1Code, link2Code, link3Code, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    const quadborrel = session.state.cards.find((card) => card.code === quadborrelCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(quadborrel).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, quadborrel!.uid, "monsterZone", 0);
    quadborrel!.faceUp = true;
    quadborrel!.position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(quadborrelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${quadborrelCode}),0,LOCATION_MZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      local old_get_first_target=Duel.GetFirstTarget
      Duel.GetFirstTarget=function() return target end
      c${quadborrelCode}.desop(e,0,nil,0,0,nil,0,0)
      Duel.GetFirstTarget=old_get_first_target
      `,
      "quadborrel-official-desop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:link-below-extra:2",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local link1=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link1Code}),0,LOCATION_EXTRA,0,nil)
      local link2=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link2Code}),0,LOCATION_EXTRA,0,nil)
      local link3=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link3Code}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("quadborrel link1 special " .. Duel.SpecialSummon(link1,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("quadborrel link2 special " .. Duel.SpecialSummon(link2,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("quadborrel link3 special " .. Duel.SpecialSummon(link3,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("quadborrel fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("quadborrel deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "quadborrel-extra-link2-or-lower-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "quadborrel link1 special 0",
        "quadborrel link2 special 0",
        "quadborrel link3 special 1",
        "quadborrel fusion special 1",
        "quadborrel deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });

  it("restores its Clock Lizard Link-2 or lower check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const quadborrelCode = "29296344";
    const link1Code = "29296345";
    const link2Code = "29296346";
    const link3Code = "29296347";
    const fusionCode = "29296348";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === quadborrelCode),
      { code: link1Code, name: "Quadborrel Lizard Link-1 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 1, attack: 1000, defense: 0 },
      { code: link2Code, name: "Quadborrel Lizard Link-2 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 2, attack: 1000, defense: 0 },
      { code: link3Code, name: "Quadborrel Lizard Link-3 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 3, attack: 1000, defense: 0 },
      { code: fusionCode, name: "Quadborrel Lizard Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 293, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [quadborrelCode], extra: [link1Code, link2Code, link3Code, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(quadborrelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${quadborrelCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(_,c) return not c:IsLinkBelow(2) end)
      `,
      "quadborrel-official-link-below-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-link-below:2",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === quadborrelCode);
    const link1 = restored.session.state.cards.find((card) => card.code === link1Code);
    const link2 = restored.session.state.cards.find((card) => card.code === link2Code);
    const link3 = restored.session.state.cards.find((card) => card.code === link3Code);
    const fusion = restored.session.state.cards.find((card) => card.code === fusionCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(link1).toBeDefined();
    expect(link2).toBeDefined();
    expect(link3).toBeDefined();
    expect(fusion).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, link1!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, link2!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, link3!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, fusion!)).toBe(false);
  });
});
