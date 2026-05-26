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
const latinCode = "15667446";
const discardSpellCode = "156674460";
const fiendTargetCode = "156674461";
const warriorDecoyCode = "156674462";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLatinumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${latinCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const discardSpellEffectId = 2;

describe.skipIf(!hasUpstreamScripts || !hasLatinumScript)("Lua real script Latinum Dark World discard revive Fiend stat", () => {
  it("restores opponent effect discard into self revive, Fiend targeting, BreakEffect, and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${latinCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 15667446, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [latinCode, fiendTargetCode, warriorDecoyCode] },
      1: { main: [discardSpellCode] },
    });
    startDuel(session);

    const latin = requireCard(session, latinCode);
    const discardSpell = requireCard(session, discardSpellCode);
    const fiendTarget = requireCard(session, fiendTargetCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    moveDuelCard(session.state, latin.uid, "hand", 0);
    moveDuelCard(session.state, discardSpell.uid, "hand", 1);
    moveFaceUpAttack(session, fiendTarget, 0, 0);
    moveFaceUpAttack(session, warriorDecoy, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${discardSpellCode}.lua`) return opponentDiscardScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(latinCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(discardSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const discard = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === discardSpell.uid);
    expect(discard, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, discard!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === latin.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      previousController: 0,
      previousLocation: "hand",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 1,
      reasonCardUid: discardSpell.uid,
      reasonEffectId: discardSpellEffectId,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: latin.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 1,
        eventReasonCardUid: discardSpell.uid,
        eventReasonEffectId: discardSpellEffectId,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1014",
        sourceUid: latin.uid,
        player: 0,
        triggerBucket: "opponentMandatory",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventPlayer: 0,
        eventCardUid: latin.uid,
        eventValue: undefined,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 1,
        eventReasonCardUid: discardSpell.uid,
        eventReasonEffectId: discardSpellEffectId,
        relatedEffectId: undefined,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === latin.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === latin.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: latin.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === fiendTarget.uid), restoredTrigger.session.state)).toBe(2100);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === warriorDecoy.uid), restoredTrigger.session.state)).toBe(1700);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === fiendTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33427456 }, sourceUid: fiendTarget.uid, value: 500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["discarded", "becameTarget", "specialSummoned", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: latin.uid, eventCode: 1018, eventName: "discarded", eventReason: duelReason.effect | duelReason.discard, eventReasonCardUid: discardSpell.uid, eventReasonEffectId: discardSpellEffectId, eventReasonPlayer: 1, previous: "hand", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: fiendTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: 1 },
      { eventCardUid: latin.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: latin.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone", relatedEffectId: undefined },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: latin.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: undefined, current: undefined, relatedEffectId: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Latinum, Exarch of Dark World");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e:SetLabel(e:GetHandler():GetPreviousControler())");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_HAND) and r&(REASON_DISCARD|REASON_EFFECT)==REASON_DISCARD|REASON_EFFECT");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_FIEND)");
  expect(script).toContain("if rp~=tp and tp==e:GetLabel() then");
  expect(script).toContain("e:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
}

function cards(): DuelCardData[] {
  return [
    { code: latinCode, name: "Latinum, Exarch of Dark World", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 6, attack: 1500, defense: 2400 },
    { code: discardSpellCode, name: "Latinum Fixture Opponent Discard", kind: "spell", typeFlags: typeSpell },
    { code: fiendTargetCode, name: "Latinum Fixture Fiend Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: warriorDecoyCode, name: "Latinum Fixture Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
  ];
}

function opponentDiscardScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_HANDES)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.operation(e,tp)
      Duel.DiscardHand(1-tp,Card.IsCode,1,1,REASON_EFFECT|REASON_DISCARD,nil,${latinCode})
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
