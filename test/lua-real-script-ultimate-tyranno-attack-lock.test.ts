import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ultimate Tyranno attack lock", () => {
  it("restores its conditional own-monster attack lock while leaving Ultimate Tyranno's attacks legal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tyrannoCode = "15894048";
    const allyCode = "15894049";
    const firstTargetCode = "15894050";
    const secondTargetCode = "15894051";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tyrannoCode),
      { code: allyCode, name: "Ultimate Tyranno Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 1900, defense: 1000 },
      { code: firstTargetCode, name: "Ultimate Tyranno First Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: secondTargetCode, name: "Ultimate Tyranno Second Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1589, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tyrannoCode, allyCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const tyranno = requireCard(session, tyrannoCode);
    const ally = requireCard(session, allyCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    for (const card of [tyranno, ally]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }
    for (const card of [firstTarget, secondTarget]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 1);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tyrannoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 85, sourceUid: tyranno.uid }),
        expect.objectContaining({ event: "continuous", code: 193, sourceUid: tyranno.uid }),
      ]),
    );
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, tyranno.uid, firstTarget.uid)).toBe(true);
    expect(hasAttack(actions, tyranno.uid, secondTarget.uid)).toBe(true);
    expect(actions.some((action) => action.type === "declareAttack" && action.attackerUid === ally.uid)).toBe(false);
    expect(restored.host.loadScript(canAttackProbe(tyrannoCode, allyCode), "ultimate-tyranno-can-attack-probe.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("ultimate tyranno can attack true/false");
  });
});

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function canAttackProbe(tyrannoCode: string, allyCode: string): string {
  return `
    local tyranno=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${tyrannoCode}),0,LOCATION_MZONE,0,nil)
    local ally=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${allyCode}),0,LOCATION_MZONE,0,nil)
    Debug.Message("ultimate tyranno can attack " .. tostring(tyranno:CanAttack()) .. "/" .. tostring(ally:CanAttack()))
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
