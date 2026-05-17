import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDragon = 0x2000;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Flash Charge Dragon force mzone summon lock", () => {
  it("restores EFFECT_FORCE_MZONE so linked zones cannot be used for Summon or Set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const flashCode = "95372220";
    const candidateCode = "95372221";
    const blockerCodes = ["95372222", "95372223", "95372224"];
    const flashCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === flashCode);
    expect(flashCard).toBeDefined();
    const cards: DuelCardData[] = [
      { ...flashCard!, linkMarkers: 0x20 },
      { code: candidateCode, name: "Flash Charge Summon Candidate", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({
        code,
        name: `Flash Charge Zone Blocker ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        race: raceDragon,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9537, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [candidateCode, ...blockerCodes], extra: [flashCode] }, 1: { main: [] } });
    startDuel(session);

    const flash = requireCard(session, flashCode);
    const candidate = requireCard(session, candidateCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, flash.uid, "monsterZone", 0);
    flash.sequence = 2;
    flash.faceUp = true;
    flash.position = "faceUpAttack";
    for (const [index, blocker] of blockers.entries()) {
      moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      blocker.sequence = [0, 1, 4][index]!;
      blocker.faceUp = true;
      blocker.position = "faceUpAttack";
    }
    moveDuelCard(session.state, candidate.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flashCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const forceZoneEffect = session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === flash.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: flash.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(restoredActions.some((action) => action.type === "normalSummon" && action.uid === candidate.uid)).toBe(false);
    expect(restoredActions.some((action) => action.type === "setMonster" && action.uid === candidate.uid)).toBe(false);

    const probe = restored.host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${flashCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("flash charge force mzone " .. tostring(c and (c:GetLinkedZone()&ZONES_MMZ)) .. "/" .. tostring(Duel.GetLocationCount(0,LOCATION_MZONE)))
      `,
      "flash-charge-force-mzone-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("flash charge force mzone 8/0");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
