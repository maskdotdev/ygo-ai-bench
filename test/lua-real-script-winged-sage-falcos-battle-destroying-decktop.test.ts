import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const falcosCode = "87523462";
const battleTargetCode = "875234620";
const deckFillerCode = "875234621";
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Winged Sage Falcos battle-destroying Deck top", () => {
  it("restores GetBattleTarget SetTargetCard into destroyed monster sent to Deck top", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${falcosCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("local bc=c:GetBattleTarget()");
    expect(script).toContain("bc:IsLocation(LOCATION_GRAVE) and bc:IsMonster() and bc:IsControler(1-tp) and bc:IsPreviousPosition(POS_FACEUP_ATTACK)");
    expect(script).toContain("Duel.SetTargetCard(bc)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,bc,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === falcosCode),
      { code: battleTargetCode, name: "Winged Sage Falcos Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: deckFillerCode, name: "Winged Sage Falcos Deck Filler", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 87523462, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [falcosCode] }, 1: { main: [battleTargetCode, deckFillerCode] } });
    startDuel(session);

    const falcos = requireCard(session, falcosCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const deckFiller = requireCard(session, deckFillerCode);
    moveDuelCard(session.state, falcos.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, deckFiller.uid, "deck", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(falcosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === falcos.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reasonCardUid: falcos.uid,
      previousLocation: "monsterZone",
      previousPosition: "faceUpAttack",
    });
    expect(session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-1-1139",
        eventName: "battleDestroyed",
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: falcos.uid,
        eventReasonPlayer: 0,
        player: 0,
        sourceUid: falcos.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === falcos.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, trigger!);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    expect(restored.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "deck",
      controller: 1,
      sequence: 0,
      reason: duelReason.effect,
      reasonCardUid: falcos.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === deckFiller.uid)).toMatchObject({ location: "deck", controller: 1, sequence: 1 });
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.eventHistory.filter((event) => ["battleDestroyed", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: battleTarget.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: falcos.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: battleTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: falcos.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "deck", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
