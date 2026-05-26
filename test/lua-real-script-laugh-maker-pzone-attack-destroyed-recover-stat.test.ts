import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const laughCode = "44944304";
const graveTargetCode = "449443040";
const boostedOpponentCode = "449443041";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLaughScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${laughCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasLaughScript)("Lua real script Laugh Maker PZone attack destroyed recover stat", () => {
  it("restores PZone recovery, attack-announced ATK gain, and boosted destroyed revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${laughCode}.lua`);
    expectLaughMakerScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 44944304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [laughCode, laughCode, graveTargetCode] }, 1: { main: [boostedOpponentCode] } });
    startDuel(session);

    const laughCards = requireCards(session, laughCode, 2);
    const pzoneLaugh = laughCards[0]!;
    const monsterLaugh = laughCards[1]!;
    const graveTarget = requireCard(session, graveTargetCode);
    const boostedOpponent = requireCard(session, boostedOpponentCode);
    moveDuelCard(session.state, pzoneLaugh.uid, "spellTrapZone", 0);
    pzoneLaugh.sequence = 0;
    pzoneLaugh.faceUp = true;
    pzoneLaugh.position = "faceUpAttack";
    moveFaceUpAttack(session, monsterLaugh, 0, 0);
    moveDuelCard(session.state, graveTarget.uid, "graveyard", 0);
    moveFaceUpAttack(session, boostedOpponent, 1, 0);
    session.state.effects.push({
      id: "laugh-maker-opponent-boost",
      sourceUid: boostedOpponent.uid,
      controller: 1,
      event: "continuous",
      code: effectUpdateAttack,
      range: ["monsterZone"],
      value: 700,
      operation: () => {},
    });
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(laughCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(currentAttack(boostedOpponent, session.state)).toBe(2300);

    const restoredPzone = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredPzone);
    expectRestoredLegalActions(restoredPzone, 0);
    const recover = getLuaRestoreLegalActions(restoredPzone, 0).find((action) => action.type === "activateEffect" && action.uid === pzoneLaugh.uid);
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredPzone, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzone, recover!);
    resolveRestoredChain(restoredPzone);
    expect(restoredPzone.session.state.players[0].lifePoints).toBe(9000);
    expect(restoredPzone.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints").map((event) => ({
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventPlayer: 0, eventValue: 1000, eventReason: duelReason.effect, eventReasonCardUid: pzoneLaugh.uid, eventReasonEffectId: 3 },
    ]);
    const afterRecoverSnapshot = serializeDuel(restoredPzone.session);

    const restoredDestroyedOpen = restoreDuelWithLuaScripts(afterRecoverSnapshot, workspace, reader);
    expectCleanRestore(restoredDestroyedOpen);
    expectRestoredLegalActions(restoredDestroyedOpen, 0);
    restoredDestroyedOpen.session.state.effects.push({
      id: "laugh-maker-self-boost",
      sourceUid: monsterLaugh.uid,
      controller: 0,
      event: "continuous",
      code: effectUpdateAttack,
      range: ["monsterZone"],
      value: 1000,
      operation: () => {},
    });
    expect(currentAttack(restoredDestroyedOpen.session.state.cards.find((card) => card.uid === monsterLaugh.uid), restoredDestroyedOpen.session.state)).toBe(3500);
    destroyDuelCard(restoredDestroyedOpen.session.state, monsterLaugh.uid, 0, duelReason.effect | duelReason.destroy, 1, "graveyard", {
      eventReasonCardUid: boostedOpponent.uid,
      eventReasonEffectId: 900,
    });
    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyedOpen.session), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const revive = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === monsterLaugh.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, revive!);
    resolveRestoredChain(restoredDestroyed);

    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === monsterLaugh.uid)).toMatchObject({
      location: "extraDeck",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: boostedOpponent.uid,
      reasonEffectId: 900,
    });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === graveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: monsterLaugh.uid,
      reasonEffectId: 10,
    });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCardUid: monsterLaugh.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: boostedOpponent.uid, eventReasonEffectId: 900, previous: "monsterZone", current: "extraDeck" },
      { eventName: "becameTarget", eventCardUid: graveTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "graveyard" },
      { eventName: "specialSummoned", eventCardUid: graveTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: monsterLaugh.uid, eventReasonEffectId: 10, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredDestroyed.session.state.players[0].lifePoints).toBe(9000);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBattle = restoreDuelWithLuaScripts(afterRecoverSnapshot, workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === monsterLaugh.uid && action.targetUid === boostedOpponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const attackTrigger = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === monsterLaugh.uid);
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, attackTrigger!);
    resolveRestoredChain(restoredAttackTrigger);

    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === monsterLaugh.uid), restoredAttackTrigger.session.state)).toBe(3500);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.sourceUid === monsterLaugh.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169408 }, sourceUid: monsterLaugh.uid, value: 1000 },
    ]);
    expect(restoredAttackTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectLaughMakerScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("Duel.SetTargetParam(1000)");
  expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.rcfilter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000*ct)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:GetPreviousAttackOnField()>c:GetBaseAttack()");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: laughCode, name: "Performapal Laugh Maker", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2500, defense: 2000, leftScale: 5, rightScale: 5 },
    { code: graveTargetCode, name: "Laugh Maker Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
    { code: boostedOpponentCode, name: "Laugh Maker Boosted Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string, count: number): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toHaveLength(count);
  return cards;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
