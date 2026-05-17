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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Steelswarm Origin force mzone extra range", () => {
  it("restores LOCATION_EXTRA-scoped EFFECT_FORCE_MZONE for Extra Deck placement only", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const originCode = "61888819";
    const linkCode = "61888820";
    const materialCode = "61888821";
    const blockerCodes = ["61888822", "61888823", "61888824", "61888825"];
    const originCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === originCode);
    expect(originCard).toBeDefined();
    const cards: DuelCardData[] = [
      { ...originCard!, linkMarkers: 0x8 },
      { code: linkCode, name: "Steelswarm Origin Extra Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 1, attack: 1000, defense: 0, linkMaterials: [materialCode] },
      { code: materialCode, name: "Steelswarm Origin Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({
        code,
        name: `Steelswarm Origin Blocker ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6188, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, ...blockerCodes], extra: [originCode, linkCode] }, 1: { main: [] } });
    startDuel(session);

    const origin = requireCard(session, originCode);
    const link = requireCard(session, linkCode);
    const material = requireCard(session, materialCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, origin.uid, "monsterZone", 0);
    origin.faceUp = true;
    origin.position = "faceUpAttack";
    moveDuelCard(session.state, material.uid, "monsterZone", 0);
    material.faceUp = true;
    material.position = "faceUpAttack";
    for (const [index, blocker] of blockers.entries()) {
      moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      blocker.faceUp = true;
      blocker.position = "faceUpAttack";
    }
    origin.sequence = 5;
    material.sequence = 3;
    for (const [index, blocker] of blockers.entries()) blocker.sequence = [0, 1, 2, 4][index]!;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(originCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const forceZoneEffect = session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === origin.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: origin.uid, targetRange: [0x40, 0x40] });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(restoredActions.some((action) => action.type === "linkSummon" && action.uid === link.uid)).toBe(false);

    const probe = restored.host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${originCode}),0,LOCATION_MZONE,0,nil)
      local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode,${materialCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("origin force mzone linked " .. tostring(c and (c:GetLinkedZone(0)&ZONES_MMZ)))
      Debug.Message("origin force mzone generic material " .. tostring(Duel.GetMZoneCount(0,g)))
      `,
      "steelswarm-origin-force-mzone-extra-range-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("origin force mzone linked 16");
    expect(restored.host.messages).toContain("origin force mzone generic material 1");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
