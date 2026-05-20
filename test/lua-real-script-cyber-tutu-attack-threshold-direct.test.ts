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
const cyberTutuCode = "49375719";
const hasCyberTutuScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cyberTutuCode}.lua`));
const weakTargetCode = "49375720";
const strongTargetCode = "49375721";
const faceDownTargetCode = "49375722";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasCyberTutuScript)("Lua real script Cyber Tutu attack-threshold direct attack", () => {
  it("restores attack-threshold and face-down gated direct attack permission", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cyberTutuCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
    expect(script).toContain("return c:IsFacedown() or c:GetAttack()<=atk");
    expect(script).toContain("return not Duel.IsExistingMatchingCard(s.filter,e:GetHandlerPlayer(),0,LOCATION_MZONE,1,nil,e:GetHandler():GetAttack())");

    const open = setupBattleDuel();
    const openTutu = requireCard(open.session, cyberTutuCode);
    const openStrong = requireCard(open.session, strongTargetCode);
    moveFaceUpAttack(open.session, openStrong, 1);
    loadAndRegister(open.session, workspace);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(open.session), workspace, open.reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const openActions = getLuaRestoreLegalActions(restoredOpen, 0);
    expect(hasDirectAttack(openActions, openTutu.uid)).toBe(true);
    expect(hasAttack(openActions, openTutu.uid, openStrong.uid)).toBe(true);

    const weakBlocked = setupBattleDuel();
    const weakTutu = requireCard(weakBlocked.session, cyberTutuCode);
    const weakTarget = requireCard(weakBlocked.session, weakTargetCode);
    moveFaceUpAttack(weakBlocked.session, weakTarget, 1);
    loadAndRegister(weakBlocked.session, workspace);
    const restoredWeakBlocked = restoreDuelWithLuaScripts(serializeDuel(weakBlocked.session), workspace, weakBlocked.reader);
    expectCleanRestore(restoredWeakBlocked);
    expectRestoredLegalActions(restoredWeakBlocked, 0);
    const weakActions = getLuaRestoreLegalActions(restoredWeakBlocked, 0);
    expect(hasDirectAttack(weakActions, weakTutu.uid)).toBe(false);
    expect(hasAttack(weakActions, weakTutu.uid, weakTarget.uid)).toBe(true);

    const faceDownBlocked = setupBattleDuel();
    const faceDownTutu = requireCard(faceDownBlocked.session, cyberTutuCode);
    const faceDownTarget = requireCard(faceDownBlocked.session, faceDownTargetCode);
    moveFaceDownDefense(faceDownBlocked.session, faceDownTarget, 1);
    loadAndRegister(faceDownBlocked.session, workspace);
    const restoredFaceDownBlocked = restoreDuelWithLuaScripts(serializeDuel(faceDownBlocked.session), workspace, faceDownBlocked.reader);
    expectCleanRestore(restoredFaceDownBlocked);
    expectRestoredLegalActions(restoredFaceDownBlocked, 0);
    const faceDownActions = getLuaRestoreLegalActions(restoredFaceDownBlocked, 0);
    expect(hasDirectAttack(faceDownActions, faceDownTutu.uid)).toBe(false);
    expect(hasAttack(faceDownActions, faceDownTutu.uid, faceDownTarget.uid)).toBe(true);
  });
});

function setupBattleDuel(): { session: DuelSession; reader: ReturnType<typeof createCardReader> } {
  const cards: DuelCardData[] = [
    { code: cyberTutuCode, name: "Cyber Tutu", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1000, defense: 800 },
    { code: weakTargetCode, name: "Cyber Tutu Weak Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: strongTargetCode, name: "Cyber Tutu Strong Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    { code: faceDownTargetCode, name: "Cyber Tutu Face-Down Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 49375719, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cyberTutuCode] }, 1: { main: [weakTargetCode, strongTargetCode, faceDownTargetCode] } });
  startDuel(session);
  const tutu = requireCard(session, cyberTutuCode);
  moveFaceUpAttack(session, tutu, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return { session, reader };
}

function loadAndRegister(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cyberTutuCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = false;
  card.position = "faceDownDefense";
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
