import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script The True Sun God special-summon attack lock", () => {
  it("restores its Special-Summoned-this-turn attack lock while leaving ordinary attackers legal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sunGodCode = "11587414";
    const specialAttackerCode = "11587415";
    const normalAttackerCode = "11587416";
    const targetCode = "11587417";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sunGodCode),
      { code: specialAttackerCode, name: "True Sun God Special Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: normalAttackerCode, name: "True Sun God Normal Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
      { code: targetCode, name: "True Sun God Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1158, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sunGodCode, specialAttackerCode, normalAttackerCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const sunGod = requireCard(session, sunGodCode);
    const specialAttacker = requireCard(session, specialAttackerCode);
    const normalAttacker = requireCard(session, normalAttackerCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, sunGod.uid, "spellTrapZone", 0);
    sunGod.faceUp = true;
    specialSummonDuelCard(session.state, specialAttacker.uid, 0);
    moveDuelCard(session.state, normalAttacker.uid, "monsterZone", 0);
    normalAttacker.faceUp = true;
    normalAttacker.position = "faceUpAttack";
    normalAttacker.summonType = "normal";
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.faceUp = true;
    target.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sunGodCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 85, sourceUid: sunGod.uid })]));
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, specialAttacker.uid, target.uid)).toBe(false);
    expect(hasAttack(actions, normalAttacker.uid, target.uid)).toBe(true);
    expect(restored.host.loadScript(canAttackProbe(specialAttackerCode, normalAttackerCode), "true-sun-god-can-attack-probe.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("true sun god can attack false/true");
  });
});

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function canAttackProbe(specialAttackerCode: string, normalAttackerCode: string): string {
  return `
    local specialAttacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${specialAttackerCode}),0,LOCATION_MZONE,0,nil)
    local normalAttacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${normalAttackerCode}),0,LOCATION_MZONE,0,nil)
    Debug.Message("true sun god can attack " .. tostring(specialAttacker:CanAttack()) .. "/" .. tostring(normalAttacker:CanAttack()))
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
