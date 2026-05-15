import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Special Summon cost gates", () => {
  it("restores official EFFECT_SPSUMMON_COST summon-type inequality predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kochiCode = "41902352";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kochiCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 419, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kochiCode] }, 1: { main: [] } });
    startDuel(session);

    const kochi = session.state.cards.find((card) => card.code === kochiCode);
    expect(kochi).toBeDefined();
    moveDuelCard(session.state, kochi!.uid, "hand", 0);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kochiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 92, sourceUid: kochi!.uid, luaCostDescriptor: `cost:special-summon-type-not:${luaSummonTypeSpecial + 182}` }),
    ]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 92, sourceUid: kochi!.uid, luaCostDescriptor: `cost:special-summon-type-not:${luaSummonTypeSpecial + 182}` }),
    ]));
    expect(restored.host.loadScript(`
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${kochiCode}), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("kochi blocked " .. tostring(target:IsCanBeSpecialSummoned(nil,182,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("kochi open " .. tostring(target:IsCanBeSpecialSummoned(nil,181,0,false,false,POS_FACEUP_ATTACK)))
      `, "restored-kochi-spsummon-cost.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("kochi blocked false");
    expect(restored.host.messages).toContain("kochi open true");
  });

  it("restores official EFFECT_SPSUMMON_COST summon-type equality predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const spiritMessageCode = "30170981";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === spiritMessageCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spiritMessageCode] }, 1: { main: [] } });
    startDuel(session);

    const spiritMessage = session.state.cards.find((card) => card.code === spiritMessageCode);
    expect(spiritMessage).toBeDefined();
    moveDuelCard(session.state, spiritMessage!.uid, "hand", 0);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spiritMessageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 92, sourceUid: spiritMessage!.uid, luaCostDescriptor: `cost:special-summon-type-is:${luaSummonTypeSpecial + 181}` }),
    ]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 92, sourceUid: spiritMessage!.uid, luaCostDescriptor: `cost:special-summon-type-is:${luaSummonTypeSpecial + 181}` }),
    ]));
    const restoredCost = restored.session.state.effects.find((effect) => effect.sourceUid === spiritMessage!.uid && effect.code === 92)?.cost;
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 181 } as never)).toBe(true);
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 182 } as never)).toBe(false);
  });
});
