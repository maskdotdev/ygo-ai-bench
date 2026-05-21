import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const unificationCode = "77432167";
const raCode = "10000010";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUnificationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unificationCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUnificationScript)("Lua real script Sun God Unification release recover", () => {
  it("restores LP payment stat boost and release-cost recovery through chain target params", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${unificationCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_TRAP_ACT_IN_SET_TURN)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_SET_AVAILABLE)");
    expect(script).toContain("Duel.GetLP(tp)-100");
    expect(script).toContain("Duel.PayLPCost(tp,cost)");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_CHAIN,0,1)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("tc:UpdateAttack(atk,nil,c)");
    expect(script).toContain("tc:UpdateDefense(atk,nil,c)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.lpfilter,1,false,nil,nil)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.lpfilter,1,1,false,nil,nil)");
    expect(script).toContain("Duel.Release(tc,REASON_COST)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(rec)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: unificationCode, name: "Sun God Unification", kind: "trap", typeFlags: typeTrap },
      { code: raCode, name: "The Winged Dragon of Ra", kind: "monster", typeFlags: typeMonster | typeEffect, level: 10, attack: 3000, defense: 2500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 77432167, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unificationCode, raCode] }, 1: { main: [] } });
    startDuel(session);

    const unification = requireCard(session, unificationCode);
    const ra = requireCard(session, raCode);
    moveDuelCard(session.state, unification.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, ra, 0);
    ra.summonType = "special";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unificationCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === unification.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { code: 1002, event: "quick", property: undefined, range: ["spellTrapZone"] },
      { code: 16, event: "continuous", property: 256, range: ["spellTrapZone"] },
      { code: 1002, event: "quick", property: 16384, range: ["spellTrapZone"] },
      { code: 1002, event: "quick", property: undefined, range: ["spellTrapZone"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const statBoost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === unification.uid && action.effectId === "lua-3-1002");
    expect(statBoost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(statBoost).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, statBoost!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(100);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === ra.uid), restoredOpen.session.state)).toBe(10900);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === ra.uid), restoredOpen.session.state)).toBe(10400);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 7900,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: unification.uid,
        eventReasonEffectId: 3,
      },
    ]);

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoosted);
    expectRestoredLegalActions(restoredBoosted, 0);
    const releaseRecover = getLuaRestoreLegalActions(restoredBoosted, 0).find((action) => action.type === "activateEffect" && action.uid === unification.uid && action.effectId === "lua-4-1002");
    expect(releaseRecover, JSON.stringify(getLuaRestoreLegalActions(restoredBoosted, 0), null, 2)).toBeDefined();
    expect(releaseRecover).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredBoosted, releaseRecover!);
    resolveRestoredChain(restoredBoosted);

    expect(restoredBoosted.session.state.cards.find((card) => card.uid === ra.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredBoosted.session.state.players[0].lifePoints).toBe(11000);
    expect(restoredBoosted.session.state.eventHistory.filter((event) => ["released", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: ra.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: unification.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 10900,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: unification.uid,
        eventReasonEffectId: 4,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
