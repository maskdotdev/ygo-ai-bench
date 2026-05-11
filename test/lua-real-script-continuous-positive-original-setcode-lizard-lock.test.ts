import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script continuous positive original setcode Clock Lizard lock", () => {
  it("restores original Aesir continuous Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "7320132";
    const aesirCode = "7320133";
    const offSetCode = "7320134";
    const setAesir = 0x4b;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode),
      { code: aesirCode, name: "Continuous Original Aesir Probe", kind: "extra", typeFlags: 0x2001, setcodes: [setAesir], race: 0x2000, attribute: 0x10, level: 10, attack: 1000, defense: 1000 },
      { code: offSetCode, name: "Continuous Original Off-Set Probe", kind: "extra", typeFlags: 0x2001, setcodes: [0x123], race: 0x2000, attribute: 0x10, level: 10, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 732, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode], extra: [aesirCode, offSetCode] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === sourceCode);
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sourceCode}),0,LOCATION_MZONE,0,nil)
      local e2=aux.createContinuousLizardCheck(c,LOCATION_MZONE,function(_,c) return c:IsOriginalSetCard(SET_AESIR) end)
      e2:SetReset(RESET_EVENT|RESETS_STANDARD)
      c:RegisterEffect(e2,true)
      `,
      "continuous-positive-original-setcode-official-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: `target:original-setcode:${setAesir}`,
      range: ["monsterZone"],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const restoredSource = restored.session.state.cards.find((card) => card.code === sourceCode);
    const aesir = restored.session.state.cards.find((card) => card.code === aesirCode);
    const offSet = restored.session.state.cards.find((card) => card.code === offSetCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(restoredSource).toBeDefined();
    expect(aesir).toBeDefined();
    expect(offSet).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSource!);
    expect(effect!.targetCardPredicate!(ctx, aesir!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, offSet!)).toBe(false);
  });
});
