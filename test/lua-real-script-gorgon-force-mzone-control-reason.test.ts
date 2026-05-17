import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gorgon of Zilofthonia force mzone control reason", () => {
  it("restores LOCATION_REASON_CONTROL force-zone value callbacks for control changes", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gorgonCode = "12067160";
    const targetCode = "12067161";
    const blockerCodes = ["12067162", "12067163", "12067164"];
    const gorgonCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gorgonCode);
    expect(gorgonCard).toBeDefined();
    const cards: DuelCardData[] = [
      { ...gorgonCard!, linkMarkers: 0x20 },
      { code: targetCode, name: "Gorgon Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({
        code,
        name: `Gorgon Zone Blocker ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 12067, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [...blockerCodes], extra: [gorgonCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const gorgon = requireCard(session, gorgonCode);
    const target = requireCard(session, targetCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, gorgon.uid, "monsterZone", 0);
    gorgon.sequence = 2;
    gorgon.faceUp = true;
    gorgon.position = "faceUpAttack";
    for (const [index, blocker] of blockers.entries()) {
      moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      blocker.sequence = [0, 1, 4][index]!;
      blocker.faceUp = true;
      blocker.position = "faceUpAttack";
    }
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.faceUp = true;
    target.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gorgonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const forceZoneEffect = session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === gorgon.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: gorgon.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const probe = restored.host.loadScript(
      `
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,0,LOCATION_MZONE,nil)
      Debug.Message("gorgon force mzone summon/control " .. tostring(Duel.GetLocationCount(0,LOCATION_MZONE)) .. "/" .. tostring(Duel.GetLocationCount(0,LOCATION_MZONE,0,LOCATION_REASON_CONTROL)))
      Debug.Message("gorgon force mzone control predicate " .. tostring(target:IsAbleToChangeControler()))
      Debug.Message("gorgon force mzone control take " .. tostring(Duel.GetControl(target,0,0,0,LOCATION_MZONE)))
      Debug.Message("gorgon force mzone control result " .. tostring(target:GetControler()) .. "/" .. tostring(target:GetSequence()))
      `,
      "gorgon-force-mzone-control-reason-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("gorgon force mzone summon/control 0/1");
    expect(restored.host.messages).toContain("gorgon force mzone control predicate true");
    expect(restored.host.messages).toContain("gorgon force mzone control take 1");
    expect(restored.host.messages).toContain("gorgon force mzone control result 0/3");
  });
});

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
