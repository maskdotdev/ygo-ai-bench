import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Elfnotes: Rhapsodia of Madness must attack center", () => {
  it("restores its center-zone must-attack-monster target filter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rhapsodiaCode = "24092792";
    const attackerCode = "24092793";
    const centerTargetCode = "24092794";
    const sideTargetCode = "24092795";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rhapsodiaCode),
      { code: attackerCode, name: "Rhapsodia Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: centerTargetCode, name: "Rhapsodia Center Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: sideTargetCode, name: "Rhapsodia Side Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2409, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rhapsodiaCode, centerTargetCode, sideTargetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const rhapsodia = requireCard(session, rhapsodiaCode);
    const attacker = requireCard(session, attackerCode);
    const centerTarget = requireCard(session, centerTargetCode);
    const sideTarget = requireCard(session, sideTargetCode);
    moveFaceUpSpell(session, rhapsodia, 0);
    moveFaceUpAttack(session, centerTarget, 0);
    moveFaceUpAttack(session, sideTarget, 0);
    moveFaceUpAttack(session, attacker, 1);
    centerTarget.sequence = 2;
    sideTarget.sequence = 0;
    attacker.sequence = 0;
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rhapsodiaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 1),
    );
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 344,
          sourceUid: rhapsodia.uid,
        }),
      ]),
    );
    const mustAttackEffects = restored.session.state.effects.filter((effect) => effect.code === 344 && effect.sourceUid === rhapsodia.uid);
    expect(mustAttackEffects).toHaveLength(1);
    expect(mustAttackEffects[0]?.range).toContain("spellTrapZone");
    expect(typeof mustAttackEffects[0]?.valueCardPredicate).toBe("function");
    const restoredRhapsodia = restored.session.state.cards.find((card) => card.uid === rhapsodia.uid)!;
    const restoredCenterTarget = restored.session.state.cards.find((card) => card.uid === centerTarget.uid)!;
    const restoredSideTarget = restored.session.state.cards.find((card) => card.uid === sideTarget.uid)!;
    const ctx = createEffectContext(restored.session.state, restoredRhapsodia, 0, undefined, restoredCenterTarget);
    expect(mustAttackEffects[0]!.canActivate!(ctx)).toBe(true);
    expect(mustAttackEffects[0]!.valueCardPredicate!(ctx, restoredCenterTarget)).toBe(true);
    expect(mustAttackEffects[0]!.valueCardPredicate!(ctx, restoredSideTarget)).toBe(false);
    const actions = getLuaRestoreLegalActions(restored, 1);
    expect(restored.session.state.cards.find((card) => card.uid === centerTarget.uid)?.sequence).toBe(2);
    expect(restored.session.state.cards.find((card) => card.uid === sideTarget.uid)?.sequence).toBe(0);
    expect(hasAttack(actions, attacker.uid, centerTarget.uid)).toBe(true);
    expect(hasAttack(actions, attacker.uid, sideTarget.uid)).toBe(false);
    expect(actions.some((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.directAttack)).toBe(false);
  });
});

function moveFaceUpSpell(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  card.faceUp = true;
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
