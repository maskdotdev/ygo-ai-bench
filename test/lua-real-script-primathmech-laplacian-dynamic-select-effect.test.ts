import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const setMathmech = 0x12f;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primathmech Laplacian dynamic SelectEffect", () => {
  it("restores table-unpacked SelectEffect choices from its Xyz Summon trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const laplacianCode = "88021907";
    const materialCodes = ["880219071", "880219072", "880219073"];
    const opponentHandCode = "880219074";
    const opponentMonsterCode = "880219075";
    const opponentSpellCode = "880219076";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === laplacianCode),
      ...materialCodes.map((code, index) => ({
        code,
        name: `Laplacian Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster,
        setcodes: [setMathmech],
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
      { code: opponentHandCode, name: "Laplacian Opponent Hand Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
      { code: opponentMonsterCode, name: "Laplacian Opponent Monster Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1500 },
      { code: opponentSpellCode, name: "Laplacian Opponent Spell Target", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 88021907, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: materialCodes, extra: [laplacianCode] }, 1: { main: [opponentHandCode, opponentMonsterCode, opponentSpellCode] } });
    startDuel(session);

    const laplacian = session.state.cards.find((card) => card.code === laplacianCode && card.location === "extraDeck");
    expect(laplacian).toBeDefined();
    for (const code of materialCodes) {
      const material = session.state.cards.find((card) => card.code === code);
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0).position = "faceUpAttack";
    }
    const opponentHand = session.state.cards.find((card) => card.code === opponentHandCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    const opponentSpell = session.state.cards.find((card) => card.code === opponentSpellCode);
    expect(opponentHand).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(opponentSpell).toBeDefined();
    moveDuelCard(session.state, opponentHand!.uid, "hand", 1);
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 1).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(laplacianCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const preSummonRestore = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(preSummonRestore.restoreComplete, preSummonRestore.incompleteReasons.join("; ")).toBe(true);
    expect(preSummonRestore.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(preSummonRestore, 0)).toEqual(getGroupedDuelLegalActions(preSummonRestore.session, 0));
    expect(getLuaRestoreLegalActionGroups(preSummonRestore, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(preSummonRestore, 0));

    const xyzSummon = getLuaRestoreLegalActions(preSummonRestore, 0).find((action) => action.type === "xyzSummon" && action.uid === laplacian!.uid);
    expect(xyzSummon, JSON.stringify(getLuaRestoreLegalActions(preSummonRestore, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(preSummonRestore, xyzSummon!);
    expect(summoned.ok, summoned.error).toBe(true);
    const restoredLaplacian = preSummonRestore.session.state.cards.find((card) => card.uid === laplacian!.uid);
    expect(restoredLaplacian).toMatchObject({ location: "monsterZone", summonType: "xyz" });
    expect(restoredLaplacian?.overlayUids).toEqual(expect.arrayContaining(materialCodes.map((code) => expect.stringContaining(code))));

    const triggerRestore = restoreDuelWithLuaScripts(serializeDuel(preSummonRestore.session), workspace, reader);
    expect(triggerRestore.restoreComplete, triggerRestore.incompleteReasons.join("; ")).toBe(true);
    expect(triggerRestore.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(triggerRestore, 0)).toEqual(getGroupedDuelLegalActions(triggerRestore.session, 0));
    expect(getLuaRestoreLegalActionGroups(triggerRestore, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(triggerRestore, 0));

    const trigger = getLuaRestoreLegalActions(triggerRestore, 0).find((action) => action.type === "activateTrigger" && action.uid === laplacian!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(triggerRestore, 0), null, 2)).toBeDefined();
    expect(trigger).toMatchObject({ triggerBucket: "turnOptional" });
    const activated = applyLuaRestoreResponse(triggerRestore, trigger!);
    expect(activated.ok, activated.error).toBe(true);
    expect(triggerRestore.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectEffect",
        player: 0,
        options: [1, 2, 3],
        returned: 1,
      }),
    ]));
    expect(triggerRestore.session.state.chain).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(triggerRestore, 0)).toEqual(getGroupedDuelLegalActions(triggerRestore.session, 0));
    expect(getLuaRestoreLegalActionGroups(triggerRestore, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(triggerRestore, 0));

    expect(triggerRestore.session.state.cards.find((card) => card.uid === opponentHand!.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
    });
    expect(triggerRestore.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(triggerRestore.session.state.cards.find((card) => card.uid === opponentSpell!.uid)).toMatchObject({ location: "spellTrapZone" });
  });
});
