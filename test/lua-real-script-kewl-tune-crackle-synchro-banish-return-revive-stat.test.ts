import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const crackleCode = "39576656";
const extraACode = "395766560";
const extraBCode = "395766561";
const extraCCode = "395766562";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrackleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crackleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeSynchro = 0x2000;
const typeTuner = 0x1000;
const raceThunder = 0x2000000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const summonTypeSynchro = 0x46000000;
const phaseEndCode = 4608;

describe.skipIf(!hasUpstreamScripts || !hasCrackleScript)("Lua real script Kewl Tune Crackle synchro banish return revive stat", () => {
  it("restores Synchro summon Extra Deck temporary banish ATK gain, return, and GY revive banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${crackleCode}.lua`));
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredCrackleField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const crackle = requireCard(restoredOpen.session, crackleCode);
    const extraA = requireCard(restoredOpen.session, extraACode);
    const extraB = requireCard(restoredOpen.session, extraBCode);
    const extraC = requireCard(restoredOpen.session, extraCCode);
    specialSummonDuelCard(restoredOpen.session.state, crackle.uid, 0, 0, {}, summonTypeSynchro, true, true);
    markProcedureComplete(restoredOpen.session.state.cards.find((card) => card.uid === crackle.uid)!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === crackle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const banish = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === crackle.uid);
    expect(banish, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, banish!);
    resolveRestoredChain(restoredSummonTrigger);

    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === extraA.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect | duelReason.temporary,
      reasonPlayer: 0,
      reasonCardUid: crackle.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredSummonTrigger.session.state.cards.find((card) => card.uid === crackle.uid), restoredSummonTrigger.session.state)).toBe(4300);
    expect(restoredSummonTrigger.session.state.effects.filter((effect) => effect.sourceUid === crackle.uid && effect.code === phaseEndCode).map((effect) => ({
      code: effect.code,
      labelObjectUid: effect.labelObjectUid,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: phaseEndCode, labelObjectUid: extraA.uid, reset: { flags: 1073742336, count: 1 }, sourceUid: crackle.uid },
    ]);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "confirmed", "banished", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: crackle.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: extraA.uid, eventPlayer: 0, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "extraDeck" },
      { eventName: "banished", eventCode: 1011, eventCardUid: extraA.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.temporary, eventReasonPlayer: 0, eventReasonCardUid: crackle.uid, eventReasonEffectId: 3, previous: "extraDeck", current: "banished" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: crackle.uid, eventReasonEffectId: 3, previous: undefined, current: undefined },
    ]);

    sendDuelCardToGraveyard(restoredSummonTrigger.session.state, crackle.uid, 0, duelReason.effect, 1);
    const restoredGraveTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), workspace, reader);
    expectCleanRestore(restoredGraveTrigger);
    expectRestoredLegalActions(restoredGraveTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredGraveTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === crackle.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredGraveTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGraveTrigger, revive!);
    resolveRestoredChain(restoredGraveTrigger);

    expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === crackle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: crackle.uid,
      reasonEffectId: 4,
    });
    for (const removed of [extraB, extraC]) {
      expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === removed.uid)).toMatchObject({
        location: "banished",
        controller: 1,
        faceUp: true,
        reason: duelReason.effect | duelReason.temporary,
        reasonPlayer: 0,
        reasonCardUid: crackle.uid,
        reasonEffectId: 4,
      });
    }
    expect(restoredGraveTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned", "confirmed", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: crackle.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: extraA.uid, eventPlayer: 0, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "extraDeck" },
      { eventName: "banished", eventCode: 1011, eventCardUid: extraA.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.temporary, eventReasonPlayer: 0, eventReasonCardUid: crackle.uid, eventReasonEffectId: 3, previous: "extraDeck", current: "banished" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: crackle.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: crackle.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: crackle.uid, eventReasonEffectId: 4, previous: "graveyard", current: "monsterZone" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: extraC.uid, eventPlayer: 0, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "extraDeck" },
      { eventName: "banished", eventCode: 1011, eventCardUid: extraC.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.temporary, eventReasonPlayer: 0, eventReasonCardUid: crackle.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: extraB.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.temporary, eventReasonPlayer: 0, eventReasonCardUid: crackle.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: extraC.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.temporary, eventReasonPlayer: 0, eventReasonCardUid: crackle.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "banished" },
    ]);
    expect(restoredGraveTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredCrackleField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 39576656, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [crackleCode] }, 1: { main: [], extra: [extraACode, extraBCode, extraCCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crackleCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Kewl Tune Crackle");
  expect(script).toContain("Synchro.AddProcedure(c,aux.FALSE,1,1,s.tunerfilter,1,99,aux.FilterSummonCode(43904702))");
  expect(script).toContain("EFFECT_CAN_BE_TUNER");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_EXTRA)>0 and Duel.IsPlayerCanRemove(tp)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,0)");
  expect(script).toContain("Duel.ConfirmCards(tp,g)");
  expect(script).toContain("local rc=g:FilterSelect(tp,Card.IsAbleToRemove,1,1,nil):GetFirst()");
  expect(script).toContain("aux.RemoveUntil(rc,POS_FACEUP,REASON_EFFECT|REASON_TEMPORARY,PHASE_END,id,e,tp,s.retop");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,3))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("c:UpdateAttack(atk)");
  expect(script).toContain("Duel.SendtoDeck(facedown_g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("Duel.SendtoExtraP(faceup_g,nil,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("c:IsSynchroSummoned() and c:IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,4))");
  expect(script).toContain("local rg=g:FilterSelect(tp,Card.IsAbleToRemove,2,2,nil)");
  expect(script).toContain("e3:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("e1:SetCode(EFFECT_MULTIPLE_TUNERS)");
}

function cards(): DuelCardData[] {
  return [
    { code: crackleCode, name: "Kewl Tune Crackle", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro | typeTuner, race: raceThunder, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
    { code: extraACode, name: "Kewl Tune Crackle Extra A", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceThunder, attribute: attributeDark, level: 7, attack: 1800, defense: 1200 },
    { code: extraBCode, name: "Kewl Tune Crackle Extra B", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceThunder, attribute: attributeDark, level: 6, attack: 1200, defense: 1000 },
    { code: extraCCode, name: "Kewl Tune Crackle Extra C", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceThunder, attribute: attributeDark, level: 5, attack: 1500, defense: 1000 },
  ];
}

function requireCard(restoredOrSession: ReturnType<typeof restoreDuelWithLuaScripts>["session"], code: string): DuelCardInstance {
  const card = restoredOrSession.state.cards.find((candidate) => candidate.code === code);
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
