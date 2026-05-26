import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ladyangeCode = "58938528";
const performapalFodderCode = "589385280";
const drawOneCode = "589385281";
const drawTwoCode = "589385282";
const oddEyesFieldCode = "589385283";
const pendulumCostCode = "589385284";
const ownTargetCode = "589385285";
const opponentAttackerCode = "589385286";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const setPerformapal = 0x9f;
const setOddEyes = 0x99;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Performapal Ladyange draw PZone attack stat", () => {
  it("restores hand discard draw, Graveyard PZone placement, and attack-announce ATK reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ladyangeCode}.lua`);
    expectScriptShape(script);

    const ladyangeData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ladyangeCode);
    expect(ladyangeData).toBeDefined();
    const reader = createCardReader([
      ladyangeData!,
      { code: performapalFodderCode, name: "Ladyange Performapal Fodder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000, setcodes: [setPerformapal] },
      { code: drawOneCode, name: "Ladyange Draw One", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: drawTwoCode, name: "Ladyange Draw Two", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: oddEyesFieldCode, name: "Ladyange Odd-Eyes Field Probe", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000, setcodes: [setOddEyes] },
      { code: pendulumCostCode, name: "Ladyange Pendulum Cost", kind: "monster", typeFlags: typeMonster | typePendulum, level: 4, attack: 1000, defense: 1000 },
      { code: ownTargetCode, name: "Ladyange Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: opponentAttackerCode, name: "Ladyange Opponent Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2400, defense: 1000 },
    ] satisfies DuelCardData[]);

    const session = createDuel({ seed: 58938528, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ladyangeCode, performapalFodderCode, drawOneCode, drawTwoCode, oddEyesFieldCode, pendulumCostCode, ownTargetCode] }, 1: { main: [opponentAttackerCode] } });
    startDuel(session);

    const ladyange = requireCard(session, ladyangeCode);
    const performapalFodder = requireCard(session, performapalFodderCode);
    const drawOne = requireCard(session, drawOneCode);
    const drawTwo = requireCard(session, drawTwoCode);
    const oddEyesField = requireCard(session, oddEyesFieldCode);
    const pendulumCost = requireCard(session, pendulumCostCode);
    const ownTarget = requireCard(session, ownTargetCode);
    const opponentAttacker = requireCard(session, opponentAttackerCode);
    moveDuelCard(session.state, ladyange.uid, "hand", 0);
    moveDuelCard(session.state, performapalFodder.uid, "hand", 0);
    moveDuelCard(session.state, pendulumCost.uid, "hand", 0);
    moveFaceUpAttack(session, oddEyesField, 0, 0);
    moveFaceUpAttack(session, ownTarget, 0, 1);
    moveFaceUpAttack(session, opponentAttacker, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ladyangeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredHand = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredHand);
    expectRestoredLegalActions(restoredHand, 0);
    const drawEffect = getLuaRestoreLegalActions(restoredHand, 0).find((action) => action.type === "activateEffect" && action.uid === ladyange.uid && action.effectId === "lua-4");
    expect(drawEffect, JSON.stringify(getLuaRestoreLegalActions(restoredHand, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHand, drawEffect!);
    resolveRestoredChain(restoredHand);

    for (const discarded of [ladyange, performapalFodder]) {
      expect(restoredHand.session.state.cards.find((card) => card.uid === discarded.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.cost | duelReason.discard,
        reasonPlayer: 0,
        reasonCardUid: ladyange.uid,
        reasonEffectId: 4,
      });
    }
    expect(restoredHand.session.state.cards.find((card) => card.uid === drawOne.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredHand.session.state.cards.find((card) => card.uid === drawTwo.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredHand.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "cardsDrawn"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "discarded", eventCardUid: performapalFodder.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ladyange.uid, eventReasonEffectId: 4 },
      { eventName: "sentToGraveyard", eventCardUid: performapalFodder.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ladyange.uid, eventReasonEffectId: 4 },
      { eventName: "discarded", eventCardUid: ladyange.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ladyange.uid, eventReasonEffectId: 4 },
      { eventName: "sentToGraveyard", eventCardUid: ladyange.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ladyange.uid, eventReasonEffectId: 4 },
      { eventName: "sentToGraveyard", eventCardUid: performapalFodder.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [performapalFodder.uid, ladyange.uid], eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ladyange.uid, eventReasonEffectId: 4 },
      { eventName: "cardsDrawn", eventCardUid: drawOne.uid, eventPlayer: 0, eventValue: 2, eventUids: [drawOne.uid, drawTwo.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ladyange.uid, eventReasonEffectId: 4 },
    ]);

    const graveSession = createDuel({ seed: 58938529, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(graveSession, { 0: { main: [ladyangeCode, oddEyesFieldCode, pendulumCostCode, ownTargetCode] }, 1: { main: [opponentAttackerCode] } });
    startDuel(graveSession);
    const graveLadyange = requireCard(graveSession, ladyangeCode);
    const graveOddEyesField = requireCard(graveSession, oddEyesFieldCode);
    const gravePendulumCost = requireCard(graveSession, pendulumCostCode);
    const graveOwnTarget = requireCard(graveSession, ownTargetCode);
    const graveOpponentAttacker = requireCard(graveSession, opponentAttackerCode);
    moveDuelCard(graveSession.state, graveLadyange.uid, "graveyard", 0);
    moveDuelCard(graveSession.state, gravePendulumCost.uid, "hand", 0);
    moveFaceUpAttack(graveSession, graveOddEyesField, 0, 0);
    moveFaceUpAttack(graveSession, graveOwnTarget, 0, 1);
    moveFaceUpAttack(graveSession, graveOpponentAttacker, 1, 0);
    graveSession.state.phase = "main1";
    graveSession.state.turnPlayer = 0;
    graveSession.state.waitingFor = 0;

    const graveHost = createLuaScriptHost(graveSession, workspace);
    expect(graveHost.loadCardScript(Number(ladyangeCode), workspace).ok).toBe(true);
    expect(graveHost.registerInitialEffects()).toBe(1);

    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(graveSession), workspace, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const placePzone = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === graveLadyange.uid);
    expect(placePzone, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, placePzone!);
    resolveRestoredChain(restoredGrave);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveLadyange.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveLadyange.uid,
    });
    expect(typeof restoredGrave.session.state.cards.find((card) => card.uid === graveLadyange.uid)?.reasonEffectId).toBe("number");

    restoredGrave.session.state.phase = "battle";
    restoredGrave.session.state.turnPlayer = 1;
    restoredGrave.session.state.waitingFor = 1;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === graveOpponentAttacker.uid && action.targetUid === graveOwnTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredAttackAnnounce = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttackAnnounce);
    expectRestoredLegalActions(restoredAttackAnnounce, 0);
    const attackTrigger = getLuaRestoreLegalActions(restoredAttackAnnounce, 0).find((action) => action.type === "activateTrigger" && action.uid === graveLadyange.uid);
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttackAnnounce, 0), null, 2)).toBeDefined();
    expect(restoredAttackAnnounce.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1130",
        eventCardUid: graveOpponentAttacker.uid,
        eventName: "attackDeclared",
        eventPlayer: 1,
        eventReason: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: graveLadyange.uid,
        triggerBucket: "opponentOptional",
      },
    ]);
    applyRestoredActionAndAssert(restoredAttackAnnounce, attackTrigger!);
    resolveRestoredChain(restoredAttackAnnounce);

    expect(restoredAttackAnnounce.session.state.cards.find((card) => card.uid === gravePendulumCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: graveLadyange.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredAttackAnnounce.session.state.cards.find((card) => card.uid === graveOpponentAttacker.uid), restoredAttackAnnounce.session.state)).toBe(1400);
    expect(restoredAttackAnnounce.session.state.effects.filter((effect) => effect.sourceUid === graveOpponentAttacker.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1107169792 }, sourceUid: graveOpponentAttacker.uid, value: -1000 },
    ]);
    expect(restoredAttackAnnounce.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.DiscardHand(tp,s.atkcostfilter,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("local bc0,bc1=Duel.GetBattleMonster(tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.drcostfilter,tp,LOCATION_HAND,0,1,1,c)");
  expect(script).toContain("Duel.SendtoGrave(g+c,REASON_DISCARD|REASON_COST)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(2)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
  expect(script).toContain("Duel.CheckPendulumZones(tp)");
  expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
