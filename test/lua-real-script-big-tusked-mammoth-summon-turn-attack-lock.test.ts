import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Big-Tusked Mammoth summon-turn attack lock", () => {
  it("restores its field cannot-attack status predicate while leaving ordinary attackers legal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mammothCode = "59380081";
    const freshAttackerCode = "59380082";
    const ordinaryAttackerCode = "59380083";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mammothCode),
      { code: freshAttackerCode, name: "Mammoth Fresh Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: ordinaryAttackerCode, name: "Mammoth Ordinary Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5938, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mammothCode] }, 1: { main: [freshAttackerCode, ordinaryAttackerCode] } });
    startDuel(session);

    const mammoth = requireCard(session, mammothCode);
    const freshAttacker = requireCard(session, freshAttackerCode);
    const ordinaryAttacker = requireCard(session, ordinaryAttackerCode);
    moveDuelCard(session.state, mammoth.uid, "monsterZone", 0);
    mammoth.faceUp = true;
    mammoth.position = "faceUpAttack";
    specialSummonDuelCard(session.state, freshAttacker.uid, 1);
    moveDuelCard(session.state, ordinaryAttacker.uid, "monsterZone", 1);
    ordinaryAttacker.faceUp = true;
    ordinaryAttacker.position = "faceUpAttack";
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mammothCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const effect = restored.session.state.effects.find((candidate) => candidate.event === "continuous" && candidate.code === 85 && candidate.sourceUid === mammoth.uid);
    expect(effect).toMatchObject({
      code: 85,
      event: "continuous",
      range: ["monsterZone"],
      sourceUid: mammoth.uid,
      targetRange: [0, 0x04],
    });
    const restoredFreshAttacker = requireCard(restored.session, freshAttackerCode);
    const restoredOrdinaryAttacker = requireCard(restored.session, ordinaryAttackerCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredFreshAttacker)).toBe(true);
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredOrdinaryAttacker)).toBe(false);
    const actions = getLuaRestoreLegalActions(restored, 1);
    expect(hasAttack(actions, freshAttacker.uid, mammoth.uid)).toBe(false);
    expect(hasAttack(actions, ordinaryAttacker.uid, mammoth.uid)).toBe(true);
    expect(restored.host.loadScript(canAttackProbe(freshAttackerCode, ordinaryAttackerCode), "big-tusked-mammoth-can-attack-probe.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("big tusked mammoth can attack false/true");
    restoredOrdinaryAttacker.customStatusMask = 0x40000000;
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredOrdinaryAttacker)).toBe(true);
  });
});

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function canAttackProbe(freshAttackerCode: string, ordinaryAttackerCode: string): string {
  return `
    local freshAttacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${freshAttackerCode}),1,LOCATION_MZONE,0,nil)
    local ordinaryAttacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ordinaryAttackerCode}),1,LOCATION_MZONE,0,nil)
    Debug.Message("big tusked mammoth can attack " .. tostring(freshAttacker:CanAttack()) .. "/" .. tostring(ordinaryAttacker:CanAttack()))
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
