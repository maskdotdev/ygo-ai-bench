import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const defconCode = "76353872";
const cyberseTargetCode = "763538720";
const attackerCode = "763538721";
const typeMonster = 0x1;
const raceCyberse = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Defcon Bird battle-target stat position", () => {
  it("restores BE_BATTLE_TARGET final ATK/DEF updates and optional SelectYesNo position change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${defconCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE+CATEGORY_POSITION)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetCode(EVENT_BE_BATTLE_TARGET)");
    expect(script).toContain("local at=Duel.GetAttackTarget()");
    expect(script).toContain("Duel.SetTargetCard(at)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,at,1,tp,at:GetBaseAttack()/2)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DEFCHANGE,at,1,tp,at:GetBaseAttack()/2)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.ChangePosition(at,POS_FACEUP_DEFENSE)");

    const defconData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === defconCode);
    expect(defconData).toBeDefined();
    const cards: DuelCardData[] = [
      defconData!,
      { code: cyberseTargetCode, name: "Defcon Bird Cyberse Target", kind: "monster", typeFlags: typeMonster, race: raceCyberse, level: 4, attack: 1600, defense: 1000 },
      { code: attackerCode, name: "Defcon Bird Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2200, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 76353872, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [defconCode, cyberseTargetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const defcon = requireCard(session, defconCode);
    const cyberseTarget = requireCard(session, cyberseTargetCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, defcon.uid, 0);
    moveFaceUpAttack(session, cyberseTarget.uid, 0);
    moveFaceUpAttack(session, attacker.uid, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(defconCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === cyberseTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: cyberseTarget.uid });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1131",
        eventCardUid: cyberseTarget.uid,
        eventCode: 1131,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventName: "battleTargeted",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: defcon.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === defcon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, trigger!);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1221661954, returned: true },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === cyberseTarget.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpDefense",
      controller: 0,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === cyberseTarget.uid), restored.session.state)).toBe(3200);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === cyberseTarget.uid), restored.session.state)).toBe(3200);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: cyberseTarget.uid,
        eventReason: 64,
        eventReasonPlayer: 0,
        eventReasonCardUid: defcon.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.position = "faceUpAttack";
  card.faceUp = true;
  return card;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
