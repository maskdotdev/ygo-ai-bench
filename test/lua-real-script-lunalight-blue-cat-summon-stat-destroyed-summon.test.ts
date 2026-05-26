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
const blueCatCode = "11439455";
const summonSpellCode = "114394550";
const destroySpellCode = "114394551";
const allyCode = "114394552";
const deckTargetCode = "114394553";
const offSetDecoyCode = "114394554";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBlueCatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blueCatCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceBeastWarrior = 0x800000;
const attributeDark = 0x20;
const setLunalight = 0xdf;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasBlueCatScript)("Lua real script Lunalight Blue Cat summon stat destroyed summon", () => {
  it("restores Special Summon target ATK final and destroyed-from-field Deck summon trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${blueCatCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 11439455, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [blueCatCode, summonSpellCode, destroySpellCode, allyCode, deckTargetCode, offSetDecoyCode] },
      1: { main: [] },
    });
    startDuel(session);

    const blueCat = requireCard(session, blueCatCode);
    const summonSpell = requireCard(session, summonSpellCode);
    const destroySpell = requireCard(session, destroySpellCode);
    const ally = requireCard(session, allyCode);
    const deckTarget = requireCard(session, deckTargetCode);
    const offSetDecoy = requireCard(session, offSetDecoyCode);
    moveDuelCard(session.state, blueCat.uid, "hand", 0);
    moveDuelCard(session.state, summonSpell.uid, "hand", 0);
    moveDuelCard(session.state, destroySpell.uid, "hand", 0);
    moveFaceUpAttack(session, ally, 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${summonSpellCode}.lua`) return summonBlueCatScript();
        if (name === `c${destroySpellCode}.lua`) return destroyBlueCatScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(blueCatCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(summonSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroySpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === summonSpell.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === blueCat.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonSpell.uid,
      reasonEffectId: 3,
    });

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    expect(restoredSummonTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1102",
        sourceUid: blueCat.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: blueCat.uid,
        eventUids: [blueCat.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonSpell.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    const attackTrigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === blueCat.uid && action.effectId === "lua-1-1102"
    );
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, attackTrigger!);
    passRestoredChain(restoredSummonTrigger);

    expect(currentAttack(restoredSummonTrigger.session.state.cards.find((card) => card.uid === ally.uid), restoredSummonTrigger.session.state)).toBe(3200);
    expect(restoredSummonTrigger.session.state.effects.filter((effect) => effect.sourceUid === ally.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 1107169792 }, sourceUid: ally.uid, value: 3200 },
    ]);

    const restoredDestroyOpen = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), source, reader);
    expectCleanRestore(restoredDestroyOpen);
    expectRestoredLegalActions(restoredDestroyOpen, 0);
    const destroy = getLuaRestoreLegalActions(restoredDestroyOpen, 0).find((action) => action.type === "activateEffect" && action.uid === destroySpell.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyOpen, destroy!);
    passRestoredChain(restoredDestroyOpen);
    expect(restoredDestroyOpen.session.state.cards.find((card) => card.uid === blueCat.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroySpell.uid,
      reasonEffectId: 4,
      previousLocation: "monsterZone",
    });

    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyOpen.session), source, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    const reviveTrigger = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === blueCat.uid && action.effectId === "lua-2-1029"
    );
    expect(reviveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyedTrigger, reviveTrigger!);
    passRestoredChain(restoredDestroyedTrigger);

    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === deckTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: blueCat.uid,
      reasonEffectId: 2,
    });
    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck" });
    expect(restoredDestroyedTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
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
      { eventCardUid: blueCat.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: summonSpell.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "hand", current: "monsterZone", relatedEffectId: undefined },
      { eventCardUid: ally.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: 1 },
      { eventCardUid: blueCat.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: summonSpell.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "hand", current: "monsterZone", relatedEffectId: 4 },
      { eventCardUid: blueCat.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: destroySpell.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: deckTarget.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: blueCat.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: undefined },
    ]);
    expect(restoredDestroyedTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Lunalight Blue Cat");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsExistingTarget(s.atkfilter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetValue(tc:GetBaseAttack()*2)");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return (r&REASON_EFFECT+REASON_BATTLE)~=0 and e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: blueCatCode, name: "Lunalight Blue Cat", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1200, setcodes: [setLunalight] },
    { code: summonSpellCode, name: "Blue Cat Fixture Summon Spell", kind: "spell", typeFlags: typeSpell },
    { code: destroySpellCode, name: "Blue Cat Fixture Destroy Spell", kind: "spell", typeFlags: typeSpell },
    { code: allyCode, name: "Blue Cat Fixture Lunalight Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000, setcodes: [setLunalight] },
    { code: deckTargetCode, name: "Blue Cat Fixture Lunalight Deck Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1400, defense: 1400, setcodes: [setLunalight] },
    { code: offSetDecoyCode, name: "Blue Cat Fixture Off-set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
  ];
}

function summonBlueCatScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.filter(c,e,tp)
      return c:IsCode(${blueCatCode}) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_HAND,0,1,nil,e,tp) end
      Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
    end
    function s.operation(e,tp)
      if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
      local g=Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)
      if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP) end
    end
  `;
}

function destroyBlueCatScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.filter(c)
      return c:IsFaceup() and c:IsCode(${blueCatCode})
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(tp) and s.filter(chkc) end
      if chk==0 then return Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,0,1,nil) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
      local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
    end
    function s.operation(e,tp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then Duel.Destroy(tc,REASON_EFFECT) end
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
