import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ballistaCode = "26443791";
const tunerCode = "264437910";
const nonTunerCode = "264437911";
const fieldInsectCode = "264437912";
const opponentMonsterCode = "264437913";
const destroySpellCode = "264437914";
const banishedA = "264437915";
const banishedB = "264437916";
const banishedC = "264437917";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBallistaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ballistaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeTuner = 0x1000;
const typeSpell = 0x2;
const raceInsect = 0x800;
const raceWarrior = 0x1;
const attributeWind = 0x10;
const effectPierce = 31;

describe.skipIf(!hasUpstreamScripts || !hasBallistaScript)("Lua real script Battlewasp Ballista banish stat destroyed revive", () => {
  it("restores Synchro summon success banish-all Insect cost into opponent ATK/DEF loss", () => {
    const { workspace, source, reader, session } = createBallistaSession(26443791);
    const ballista = requireCard(session, ballistaCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const fieldInsect = requireCard(session, fieldInsectCode);
    const opponent = requireCard(session, opponentMonsterCode);
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, nonTuner, 0, 1);
    moveFaceUpAttack(session, fieldInsect, 0, 2);
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(ballistaCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === ballista.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { code: effectPierce, event: "continuous", id: "lua-1-31", range: ["extraDeck"] },
      { code: 203, event: "continuous", id: "lua-3-203", range: ["extraDeck"] },
      { code: 1102, event: "trigger", id: "lua-4-1102", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { code: 1029, event: "trigger", id: "lua-5-1029", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchro = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "synchroSummon" && action.uid === ballista.uid && action.materialUids.includes(tuner.uid) && action.materialUids.includes(nonTuner.uid)
    );
    expect(synchro, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, synchro!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === ballista.uid && action.effectId === "lua-4-1102"
    );
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, statTrigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ballista.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === fieldInsect.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: true,
      reason: 0,
      reasonPlayer: 0,
    });
    for (const card of [tuner, nonTuner]) {
      expect(restoredTrigger.session.state.cards.find((candidate) => candidate.uid === card.uid)).toMatchObject({
        location: "banished",
        faceUp: true,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: ballista.uid,
        reasonEffectId: 4,
      });
    }
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredTrigger.session.state)).toBe(2000);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredTrigger.session.state)).toBe(1800);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned", "banished"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: tuner.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.synchro, eventReasonCardUid: ballista.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: nonTuner.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.synchro, eventReasonCardUid: ballista.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: ballista.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: tuner.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: ballista.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
      { eventCardUid: nonTuner.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: ballista.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
      { eventCardUid: tuner.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: ballista.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores opponent-destroyed Synchro Ballista into three banished Insect summons", () => {
    const { workspace, source, reader, session } = createBallistaSession(26443792);
    const ballista = requireCard(session, ballistaCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const destroySpell = requireCard(session, destroySpellCode);
    const insects = [requireCard(session, banishedA), requireCard(session, banishedB), requireCard(session, banishedC)];
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, nonTuner, 0, 1);
    moveDuelCard(session.state, destroySpell.uid, "hand", 1);
    for (const insect of insects) moveDuelCard(session.state, insect.uid, "banished", 0).faceUp = true;
    synchroSummonDuelCard(session.state, 0, ballista.uid, [tuner.uid, nonTuner.uid]);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(ballistaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroySpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const destroy = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === destroySpell.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, destroy!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === ballista.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      summonType: "synchro",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroySpell.uid,
      reasonEffectId: 6,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === ballista.uid && action.effectId === "lua-5-1029"
    );
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, revive!);
    passRestoredChain(restoredTrigger);

    for (const insect of insects) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === insect.uid)).toMatchObject({
        location: "monsterZone",
        controller: 0,
        faceUp: true,
        position: "faceUpAttack",
        summonType: "special",
        reason: duelReason.summon | duelReason.specialSummon,
        reasonPlayer: 0,
        reasonCardUid: ballista.uid,
        reasonEffectId: 5,
      });
    }
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: ballista.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: ballista.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: destroySpell.uid, eventReasonEffectId: 6, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: insects[0]!.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: ballista.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "banished", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createBallistaSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${ballistaCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [tunerCode, nonTunerCode, fieldInsectCode, banishedA, banishedB, banishedC], extra: [ballistaCode] },
    1: { main: [opponentMonsterCode, destroySpellCode] },
  });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${destroySpellCode}.lua`) return opponentDestroyScript();
      return workspace.readScript(name);
    },
  };
  return { workspace, source, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Battlewasp - Ballista the Armageddon");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,nil)");
  expect(script).toContain("g:FilterCount(Card.IsAbleToRemoveAsCost,nil)==#g");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_INSECT),tp,LOCATION_REMOVED,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return rp==1-tp and c:IsSynchroSummoned()");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_REMOVED,0,3,3,nil,e,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: ballistaCode, name: "Battlewasp - Ballista the Armageddon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceInsect, attribute: attributeWind, level: 12, attack: 3000, defense: 800 },
    { code: tunerCode, name: "Ballista Fixture Insect Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceInsect, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: nonTunerCode, name: "Ballista Fixture Insect Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeWind, level: 8, attack: 1000, defense: 1000 },
    { code: fieldInsectCode, name: "Ballista Fixture Field Insect", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: opponentMonsterCode, name: "Ballista Fixture Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 3000, defense: 2800 },
    { code: destroySpellCode, name: "Ballista Fixture Opponent Destroy Spell", kind: "spell", typeFlags: typeSpell },
    { code: banishedA, name: "Ballista Fixture Banished Insect A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
    { code: banishedB, name: "Ballista Fixture Banished Insect B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeWind, level: 4, attack: 1300, defense: 1000 },
    { code: banishedC, name: "Ballista Fixture Banished Insect C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeWind, level: 4, attack: 1400, defense: 1000 },
  ];
}

function opponentDestroyScript(): string {
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
      return c:IsFaceup() and c:IsCode(${ballistaCode})
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(1-tp) and s.filter(chkc) end
      if chk==0 then return Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
      local g=Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)
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
