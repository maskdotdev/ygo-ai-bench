import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { normalSummon } from "#duel/summon.js";
import type { DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEnergyBraveryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c72631243.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasEnergyBraveryScript)("Lua real script Energy Bravery Gemini indestructible", () => {
  it("restores its field effect-destruction protection only for Gemini-status monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const energyBraveryCode = "72631243";
    const geminiCode = "3918345";
    const decoyCode = "72631244";
    const script = workspace.readScript(`c${energyBraveryCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("return c:IsGeminiStatus()");
    expect(script).toContain("e1:SetValue(1)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [energyBraveryCode, geminiCode].includes(card.code)),
      { code: decoyCode, name: "Energy Bravery Vulnerable Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 72631243, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [energyBraveryCode, geminiCode, decoyCode] }, 1: { main: [] } });
    startDuel(session);

    const energyBravery = requireCard(session, energyBraveryCode);
    const gemini = requireCard(session, geminiCode);
    const decoy = requireCard(session, decoyCode);
    for (const card of [energyBravery, gemini, decoy]) {
      const moved = moveDuelCard(session.state, card.uid, "monsterZone", 0);
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    }
    session.state.players[0].normalSummonAvailable = true;
    normalSummon(session.state, 0, gemini.uid, () => {}, () => false, () => true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(energyBraveryCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === energyBravery.uid && effect.code === 41)).toMatchObject({
      luaTargetDescriptor: "target:gemini-status",
      range: ["monsterZone"],
      targetRange: [0x04, 0],
      value: 1,
    });
    assertGeminiStatus(restored, geminiCode, decoyCode);

    const protectedDestroy = destroyDuelCard(restored.session.state, gemini.uid, 1, duelReason.effect | duelReason.destroy, 1);
    expect(protectedDestroy).toMatchObject({ uid: gemini.uid, location: "monsterZone", controller: 0 });
    const vulnerableDestroy = destroyDuelCard(restored.session.state, decoy.uid, 1, duelReason.effect | duelReason.destroy, 1);
    expect(vulnerableDestroy).toMatchObject({ uid: decoy.uid, location: "graveyard", previousController: 0, reason: duelReason.effect | duelReason.destroy });
    expect(restored.session.state.cards.find((card) => card.uid === energyBravery.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, geminiCode: string, decoyCode: string): void {
  const result = restored.host.loadScript(
    `
      local gemini = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${geminiCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local decoy = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${decoyCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("energy bravery gemini status " .. tostring(gemini and gemini:IsGeminiStatus()) .. "/" .. tostring(decoy and decoy:IsGeminiStatus()))
    `,
    "energy-bravery-gemini-status-probe.lua",
  );
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages).toContain("energy bravery gemini status true/false");
}
