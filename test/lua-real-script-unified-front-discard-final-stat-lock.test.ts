import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const unifiedFrontCode = "31472884";
const discardCode = "314728840";
const targetCode = "314728841";
const sameStatDecoyCode = "314728842";
const opponentCode = "314728843";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUnifiedFrontScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unifiedFrontCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUnifiedFrontScript)("Lua real script Unified Front discard final stat lock", () => {
  it("restores discard-cost stat cloning and player direct-attack oath lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${unifiedFrontCode}.lua`);
    expect(script).toContain("aux.GlobalCheck(s,function()");
    expect(script).toContain("ge1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.RegisterFlagEffect(tc:GetControler(),id,RESET_PHASE|PHASE_END,0,1)");
    expect(script).toContain("Duel.GetFlagEffect(tp,id)==0");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,g:GetFirst())");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(atk)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(def)");

    const cards: DuelCardData[] = [
      { code: unifiedFrontCode, name: "Unified Front", kind: "spell", typeFlags: typeSpell },
      { code: discardCode, name: "Unified Front Discard Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: targetCode, name: "Unified Front Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 2100 },
      { code: sameStatDecoyCode, name: "Unified Front Same Stat Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: opponentCode, name: "Unified Front Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1300, defense: 1300 },
    ];
    const reader = createCardReader(cards);
    const source = { readScript(name: string) { return workspace.readScript(name); } };
    const session = createDuel({ seed: 31472884, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unifiedFrontCode, discardCode, targetCode, sameStatDecoyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const unifiedFront = requireCard(session, unifiedFrontCode);
    const discard = requireCard(session, discardCode);
    const target = requireCard(session, targetCode);
    const sameStatDecoy = requireCard(session, sameStatDecoyCode);
    const opponent = requireCard(session, opponentCode);
    moveDuelCard(session.state, unifiedFront.uid, "hand", 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, sameStatDecoy, 0).sequence = 1;
    moveFaceUpAttack(session, opponent, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unifiedFrontCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === unifiedFront.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
    });
    resolveRestoredChain(restoredOpen);
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!;
    const restoredDecoy = restoredOpen.session.state.cards.find((card) => card.uid === sameStatDecoy.uid)!;
    expect(currentAttack(restoredTarget, restoredOpen.session.state)).toBe(1800);
    expect(currentDefense(restoredTarget, restoredOpen.session.state)).toBe(1200);
    expect(currentAttack(restoredDecoy, restoredOpen.session.state)).toBe(1800);
    expect(currentDefense(restoredDecoy, restoredOpen.session.state)).toBe(1200);
    expect(restoredOpen.session.state.effects.filter((effect) => [73, 102, 106].includes(effect.code ?? -1)).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: unifiedFront.uid, code: 73, reset: { flags: 1073742336 }, value: undefined },
      { sourceUid: target.uid, code: 102, reset: { flags: 1107169792 }, value: 1800 },
      { sourceUid: target.uid, code: 106, reset: { flags: 1107169792 }, value: 1200 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventPreviousState: { location: "hand", controller: 0, sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: unifiedFront.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredBattle, 0).some((action) => action.type === "declareAttack" && action.attackerUid === target.uid && action.directAttack === true)).toBe(false);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === target.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyAndAssert(restoredBattle.session, attack!);
    passBattleResponses(restoredBattle.session);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(500);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7500);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
