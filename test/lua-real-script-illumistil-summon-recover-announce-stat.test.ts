import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const illumistilCode = "74139959";
const opponentSummonCode = "741399590";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasIllumistilScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${illumistilCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;

describe.skipIf(!hasUpstreamScripts || !hasIllumistilScript)("Lua real script Illumistil summon recover announce stat", () => {
  it("restores opponent Special Summon LP recovery and AnnounceNumber LP payment into ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${illumistilCode}.lua`);
    expectIllumistilScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 74139959, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [illumistilCode] }, 1: { main: [opponentSummonCode] } });
    startDuel(session);

    const illumistil = requireCard(session, illumistilCode);
    const opponentSummon = requireCard(session, opponentSummonCode);
    moveDuelCard(session.state, illumistil.uid, "monsterZone", 0).position = "faceUpAttack";
    illumistil.faceUp = true;
    moveDuelCard(session.state, opponentSummon.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(illumistilCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 2000 }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, opponentSummon.uid, 1, 0, { eventReasonCardUid: opponentSummon.uid, eventReasonEffectId: 900 }, 0, true, true);
    expect(restoredOpen.session.state.players[0]!.lifePoints).toBe(9800);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["specialSummoned", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: opponentSummon.uid,
        eventPlayer: undefined,
        eventValue: undefined,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: opponentSummon.uid,
        eventReasonEffectId: 900,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventCardUid: undefined,
        eventPlayer: 0,
        eventValue: 1800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: illumistil.uid,
        eventReasonEffectId: 2,
      },
    ]);

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, {
      promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 2000 }],
    });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const boost = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === illumistil.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, boost!);
    expect(restoredQuick.host.promptDecisions.map((decision) => ({
      api: decision.api,
      player: decision.player,
      options: "options" in decision ? decision.options : undefined,
      returned: decision.returned,
    }))).toEqual([{ api: "AnnounceNumber", player: 0, options: [1000, 2000, 3000], returned: 2000 }]);
    resolveRestoredChain(restoredQuick);
    expect(restoredQuick.session.state.players[0]!.lifePoints).toBe(7800);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === illumistil.uid), restoredQuick.session.state)).toBe(5000);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredQuick.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 2000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: illumistil.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function expectIllumistilScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),3)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.IsMainPhase() and eg:IsExists(aux.FaceupFilter(Card.IsSummonPlayer,1-tp),1,nil)");
  expect(script).toContain("Duel.IsChainSolving()");
  expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("Duel.Recover(tp,val,REASON_EFFECT)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()");
  expect(script).toContain("Duel.AnnounceNumber(tp,cost_options)");
  expect(script).toContain("Duel.PayLPCost(tp,lp_cost)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
}

function cards(): DuelCardData[] {
  return [
    { code: illumistilCode, name: "Cosmic Tree Illumistil", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 4, attack: 3000, defense: 0, linkMarkers: 0x2b },
    { code: opponentSummonCode, name: "Illumistil Opponent Summon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
