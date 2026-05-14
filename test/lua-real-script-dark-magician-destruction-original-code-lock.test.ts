import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeFusion, luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Magician of Destruction original-code lock", () => {
  it("restores original-code Fusion or alternate-procedure summon locks without using current code", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkMagicianDestructionCode = "59400890";
    const changedCode = "59400891";
    const otherFusionCode = "59400892";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkMagicianDestructionCode),
      { code: otherFusionCode, name: "Dark Magician Destruction Other Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 594, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [darkMagicianDestructionCode, otherFusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkMagicianDestructionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianDestructionCode);
    expect(darkMagician).toBeDefined();
    session.state.effects.push({
      id: "test-change-dark-magician-destruction-code",
      sourceUid: darkMagician!.uid,
      controller: 0,
      ownerPlayer: 0,
      event: "continuous",
      code: 114,
      range: ["extraDeck"],
      value: Number(changedCode),
      operation: () => undefined,
    });
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsOriginalCode,${darkMagicianDestructionCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("changed original/current " .. c:GetOriginalCode() .. "/" .. c:GetCode())
      local e=Effect.CreateEffect(c)
      c${darkMagicianDestructionCode}.regop(e,0,nil,0,0,nil,0,0)
      `,
      "dark-magician-destruction-official-original-code-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(host.messages).toContain(`changed original/current ${darkMagicianDestructionCode}/${changedCode}`);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:summon-type-code-any:original:${luaSummonTypeFusion},${luaSummonTypeSpecial + 1}:${darkMagicianDestructionCode}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local dark_magician=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsOriginalCode,${darkMagicianDestructionCode}),0,LOCATION_EXTRA,0,nil)
      local other_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${otherFusionCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("restored original/current " .. dark_magician:GetOriginalCode() .. "/" .. dark_magician:GetCode())
      Debug.Message("dark magician fusion special " .. Duel.SpecialSummon(dark_magician,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("dark magician alternate special " .. Duel.SpecialSummon(dark_magician,SUMMON_TYPE_SPECIAL+1,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("other fusion special " .. Duel.SpecialSummon(other_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "dark-magician-destruction-original-code-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        `restored original/current ${darkMagicianDestructionCode}/${changedCode}`,
        "dark magician fusion special 0",
        "dark magician alternate special 0",
        "other fusion special 1",
      ]),
    );
  });
});
