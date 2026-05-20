import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const blackTyrannoCode = "38670435";
const hasBlackTyrannoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blackTyrannoCode}.lua`));
const defenseTargetCode = "38670436";
const attackTargetCode = "38670437";
const spellTrapCode = "38670438";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasBlackTyrannoScript)("Lua real script Black Tyranno conditional direct attack", () => {
  it("restores S/T count and Attack Position monster gated direct attack permission", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blackTyrannoCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_SZONE)==0");
    expect(script).toContain("not Duel.IsExistingMatchingCard(Card.IsAttackPos,tp,0,LOCATION_MZONE,1,nil)");

    const open = setupBattleDuel();
    const openTyranno = requireCard(open.session, blackTyrannoCode);
    const openDefense = requireCard(open.session, defenseTargetCode);
    moveFaceUpDefense(open.session, openDefense, 1);
    loadAndRegister(open.session, workspace);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(open.session), workspace, open.reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const openActions = getLuaRestoreLegalActions(restoredOpen, 0);
    expect(hasDirectAttack(openActions, openTyranno.uid)).toBe(true);
    expect(hasAttack(openActions, openTyranno.uid, openDefense.uid)).toBe(true);

    const attackBlocked = setupBattleDuel();
    const blockedTyranno = requireCard(attackBlocked.session, blackTyrannoCode);
    const blockedAttackTarget = requireCard(attackBlocked.session, attackTargetCode);
    moveFaceUpAttack(attackBlocked.session, blockedAttackTarget, 1);
    loadAndRegister(attackBlocked.session, workspace);
    const restoredAttackBlocked = restoreDuelWithLuaScripts(serializeDuel(attackBlocked.session), workspace, attackBlocked.reader);
    expectCleanRestore(restoredAttackBlocked);
    expectRestoredLegalActions(restoredAttackBlocked, 0);
    const attackBlockedActions = getLuaRestoreLegalActions(restoredAttackBlocked, 0);
    expect(hasDirectAttack(attackBlockedActions, blockedTyranno.uid)).toBe(false);
    expect(hasAttack(attackBlockedActions, blockedTyranno.uid, blockedAttackTarget.uid)).toBe(true);

    const spellBlocked = setupBattleDuel();
    const spellBlockedTyranno = requireCard(spellBlocked.session, blackTyrannoCode);
    const spellBlockedDefense = requireCard(spellBlocked.session, defenseTargetCode);
    const spellTrap = requireCard(spellBlocked.session, spellTrapCode);
    moveFaceUpDefense(spellBlocked.session, spellBlockedDefense, 1);
    moveDuelCard(spellBlocked.session.state, spellTrap.uid, "spellTrapZone", 1);
    spellTrap.faceUp = true;
    loadAndRegister(spellBlocked.session, workspace);
    const restoredSpellBlocked = restoreDuelWithLuaScripts(serializeDuel(spellBlocked.session), workspace, spellBlocked.reader);
    expectCleanRestore(restoredSpellBlocked);
    expectRestoredLegalActions(restoredSpellBlocked, 0);
    const spellBlockedActions = getLuaRestoreLegalActions(restoredSpellBlocked, 0);
    expect(hasDirectAttack(spellBlockedActions, spellBlockedTyranno.uid)).toBe(false);
    expect(hasAttack(spellBlockedActions, spellBlockedTyranno.uid, spellBlockedDefense.uid)).toBe(true);
  });
});

function setupBattleDuel(): { session: DuelSession; reader: ReturnType<typeof createCardReader> } {
  const cards: DuelCardData[] = [
    { code: blackTyrannoCode, name: "Black Tyranno", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2600, defense: 1800 },
    { code: defenseTargetCode, name: "Black Tyranno Defense Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1200 },
    { code: attackTargetCode, name: "Black Tyranno Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1200 },
    { code: spellTrapCode, name: "Black Tyranno Spell/Trap Gate", kind: "spell", typeFlags: typeSpell },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 38670435, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [blackTyrannoCode] }, 1: { main: [defenseTargetCode, attackTargetCode, spellTrapCode] } });
  startDuel(session);
  const tyranno = requireCard(session, blackTyrannoCode);
  moveFaceUpAttack(session, tyranno, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return { session, reader };
}

function loadAndRegister(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(blackTyrannoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpDefense";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true && action.targetUid === undefined);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
