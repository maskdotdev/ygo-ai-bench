import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
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
const raceCyberse = 0x1000000;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Elphase linked group stat", () => {
  it("restores GetLinkedGroupCount dynamic ATK from the monster it points to", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const elphaseCode = "60292055";
    const linkedMonsterCode = "60292056";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === elphaseCode),
      { code: linkedMonsterCode, name: "Elphase Linked Cyberse Fixture", kind: "monster", typeFlags: typeMonster, race: raceCyberse, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6029, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [linkedMonsterCode], extra: [elphaseCode] }, 1: { main: [] } });
    startDuel(session);

    const elphase = requireCard(session, elphaseCode);
    const linkedMonster = requireCard(session, linkedMonsterCode);
    moveDuelCard(session.state, elphase.uid, "monsterZone", 0);
    elphase.faceUp = true;
    elphase.position = "faceUpAttack";
    moveDuelCard(session.state, linkedMonster.uid, "monsterZone", 0);
    elphase.sequence = 2;
    linkedMonster.sequence = 3;
    linkedMonster.faceUp = true;
    linkedMonster.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(elphaseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentAttack(elphase, session.state)).toBe((elphase.data.attack ?? 0) + 300);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const restoredElphase = restored.session.state.cards.find((card) => card.uid === elphase.uid);
    const restoredLinkedMonster = restored.session.state.cards.find((card) => card.uid === linkedMonster.uid);
    expect(restoredElphase).toMatchObject({ location: "monsterZone", sequence: 2, faceUp: true });
    expect(restoredLinkedMonster).toMatchObject({ location: "monsterZone", sequence: 3, faceUp: true });
    expect(currentAttack(restoredElphase, restored.session.state)).toBe((elphase.data.attack ?? 0) + 300);

    const probe = restored.host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${elphaseCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("elphase linked group stat " .. tostring(c and c:GetLinkedGroupCount()) .. "/" .. tostring(c and c:GetAttack()))
      `,
      "elphase-linked-group-stat-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain(`elphase linked group stat 1/${(elphase.data.attack ?? 0) + 300}`);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
