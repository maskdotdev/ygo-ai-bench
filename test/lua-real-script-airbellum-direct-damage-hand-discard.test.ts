import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const airbellumCode = "90508760";
const discardACode = "905087600";
const discardBCode = "905087601";
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script X-Saber Airbellum direct damage hand discard", () => {
  it("restores its direct battle-damage trigger into random opponent hand discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${airbellumCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_HANDES)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("return ep~=tp and Duel.GetAttackTarget()==nil");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,0,0,1-tp,1)");
    expect(script).toContain("Duel.GetFieldGroup(ep,LOCATION_HAND,0,nil)");
    expect(script).toContain("g:RandomSelect(1-tp,1)");
    expect(script).toContain("Duel.SendtoGrave(sg,REASON_DISCARD|REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === airbellumCode),
      { code: discardACode, name: "Airbellum Fixture Discard A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: discardBCode, name: "Airbellum Fixture Discard B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 90508760, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [airbellumCode] }, 1: { main: [discardACode, discardBCode] } });
    startDuel(session);

    const airbellum = requireCard(session, airbellumCode);
    const discardA = requireCard(session, discardACode);
    const discardB = requireCard(session, discardBCode);
    moveDuelCard(session.state, airbellum.uid, "monsterZone", 0);
    airbellum.faceUp = true;
    airbellum.position = "faceUpAttack";
    moveDuelCard(session.state, discardA.uid, "hand", 1);
    moveDuelCard(session.state, discardB.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(airbellumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === airbellum.uid && action.directAttack,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);

    expect(restoredBattle.session.state.players[1]!.lifePoints).toBe(6400);
    expect(restoredBattle.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-1-1143",
        eventCardUid: airbellum.uid,
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventReason: duelReason.battle,
        eventReasonCardUid: airbellum.uid,
        eventReasonPlayer: 0,
        eventValue: 1600,
        player: 0,
        sourceUid: airbellum.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === airbellum.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    const discarded = [discardA, discardB].filter((card) => restoredTrigger.session.state.cards.find((candidate) => candidate.uid === card.uid)?.location === "graveyard");
    const remaining = [discardA, discardB].filter((card) => restoredTrigger.session.state.cards.find((candidate) => candidate.uid === card.uid)?.location === "hand");
    expect(discarded).toHaveLength(1);
    expect(remaining).toHaveLength(1);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discarded[0]!.uid,
        eventReason: duelReason.discard | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: airbellum.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: discarded[0]!.uid === discardA.uid ? 0 : 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
