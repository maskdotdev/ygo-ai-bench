import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const setNaturia = 0x2a;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Naturia Blessing SelectEffect", () => {
  it("restores selected SelectEffect branch into the Naturia Special Summon operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blessingCode = "34813545";
    const naturiaCode = "34813546";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blessingCode),
      { code: naturiaCode, name: "Naturia Blessing Target", kind: "monster", typeFlags: typeMonster, setcodes: [setNaturia], level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 348, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blessingCode, naturiaCode] }, 1: { main: [] } });
    startDuel(session);

    const blessing = requireCard(session, blessingCode);
    const naturia = requireCard(session, naturiaCode);
    moveDuelCard(session.state, blessing.uid, "hand", 0);
    moveDuelCard(session.state, naturia.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blessingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === blessing.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activation!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectEffect",
        player: 0,
        options: [1],
        returned: 1,
      }),
    ]));

    expect(restored.session.state.cards.find((card) => card.uid === naturia.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === blessing.uid)).toMatchObject({
      location: "graveyard",
    });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
