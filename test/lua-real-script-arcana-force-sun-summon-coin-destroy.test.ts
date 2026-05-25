import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const sunCode = "39761418";
const ownSpellCode = "397614180";
const opponentTrapCode = "397614181";
const hasSunScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sunCode}.lua`));
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSunScript)("Lua real script Arcana Force Sun summon coin destroy", () => {
  it("restores summon-success TossCoin trigger into Spell/Trap-zone destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sunCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sunCode, ownSpellCode] }, 1: { main: [opponentTrapCode] } });
    startDuel(session);

    const sun = requireCard(session, sunCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    moveDuelCard(session.state, sun.uid, "monsterZone", 0);
    sun.sequence = 0;
    sun.faceUp = true;
    sun.position = "faceUpAttack";
    moveSpellTrap(session, ownSpell, 0, 0);
    moveSpellTrap(session, opponentTrap, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sunCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const raised = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${sunCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Duel.RaiseEvent(c,EVENT_SUMMON_SUCCESS,nil,REASON_SUMMON,0,0,0)
      `,
      "arcana-force-sun-summon-success.lua",
    );
    expect(raised.ok, raised.error).toBe(true);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-2-1100",
        sourceUid: sun.uid,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: sun.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [sun.uid],
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sun.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([0]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ownSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sun.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTrap.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sun.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: sun.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [sun.uid],
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sun.uid,
        eventReasonEffectId: 2,
      },
      destroyedEvent(ownSpell.uid, sun.uid, 0, undefined),
      destroyedEvent(opponentTrap.uid, sun.uid, 0, undefined),
      destroyedEvent(ownSpell.uid, sun.uid, 0, [ownSpell.uid, opponentTrap.uid]),
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force XIX - The Sun");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(function(c) return c.toss_coin and c:IsFaceup() end,0,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COIN+CATEGORY_DESTROY+CATEGORY_SET)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e4:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,sg,#sg,tp,0)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("{b1,aux.GetCoinEffectHintString(COIN_HEADS)}");
  expect(script).toContain("{b2,aux.GetCoinEffectHintString(COIN_TAILS)}");
  expect(script).toContain("coin=Duel.TossCoin(tp,1)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,g)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsSpellTrap,tp,LOCATION_STZONE,LOCATION_STZONE,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const sun = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === sunCode);
  expect(sun).toBeDefined();
  return [
    sun!,
    { code: ownSpellCode, name: "Arcana Sun Own Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTrapCode, name: "Arcana Sun Opponent Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function destroyedEvent(cardUid: string, sourceUid: string, sequence: number, eventUids: string[] | undefined) {
  const event = {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.destroy | duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: cardUid.includes(opponentTrapCode) ? 1 : 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence },
    eventCurrentState: { controller: cardUid.includes(opponentTrapCode) ? 1 : 0, faceUp: true, location: "graveyard", position: "faceDown", sequence },
  };
  return eventUids ? { ...event, eventUids } : event;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
