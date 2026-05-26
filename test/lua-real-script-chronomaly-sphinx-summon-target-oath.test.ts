import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const sphinxCode = "65591858";
const revivedCode = "65591859";
const offSetProbeCode = "65591860";
const chronomalyProbeCode = "65591861";
const hasSphinxScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sphinxCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceRock = 0x800;
const attributeEarth = 0x4;
const setChronomaly = 0x70;
const effectCannotSpecialSummon = 22;
const duelActivitySpecialSummon = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasSphinxScript)("Lua real script Chronomaly Winged Sphinx summon target oath", () => {
  it("restores summon-success Graveyard target revive and Chronomaly Special Summon oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${sphinxCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_SPSUMMON,s.counterfilter)");
    expect(script).toContain("Duel.GetCustomActivityCount(id,tp,ACTIVITY_SPSUMMON)==0");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,1),nil)");
    expect(script).toContain("return not c:IsSetCard(SET_CHRONOMALY)");
    expect(script).toContain("return c:GetLevel()==5 and c:IsSetCard(SET_CHRONOMALY)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: sphinxCode, name: "Chronomaly Winged Sphinx", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1600, defense: 1900, setcodes: [setChronomaly] },
      { code: revivedCode, name: "Chronomaly Level 5 Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 5, attack: 1800, defense: 1000, setcodes: [setChronomaly] },
      { code: offSetProbeCode, name: "Chronomaly Off-Set Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
      { code: chronomalyProbeCode, name: "Chronomaly Hand Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, setcodes: [setChronomaly] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 65591858, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sphinxCode, revivedCode, offSetProbeCode, chronomalyProbeCode] }, 1: { main: [] } });
    startDuel(session);

    const sphinx = requireCard(session, sphinxCode);
    const revived = requireCard(session, revivedCode);
    const offSetProbe = requireCard(session, offSetProbeCode);
    const chronomalyProbe = requireCard(session, chronomalyProbeCode);
    moveDuelCard(session.state, sphinx.uid, "hand", 0);
    moveDuelCard(session.state, revived.uid, "graveyard", 0);
    moveDuelCard(session.state, offSetProbe.uid, "hand", 0);
    moveDuelCard(session.state, chronomalyProbe.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${offSetProbeCode}.lua`) return handSummonProbeScript("off-set hand probe");
        if (name === `c${chronomalyProbeCode}.lua`) return handSummonProbeScript("chronomaly hand probe");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sphinxCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(offSetProbeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chronomalyProbeCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === sphinx.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummon, normalSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1100",
        sourceUid: sphinx.uid,
        player: 0,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: sphinx.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        id: "trigger-3-1",
        triggerBucket: "turnOptional",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sphinx.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.host.promptDecisions).toEqual([]);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === revived.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: sphinx.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([
      { player: 0, activity: duelActivitySpecialSummon, cardUid: revived.uid },
    ]);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectCannotSpecialSummon)).toEqual([
      expect.objectContaining({
        code: effectCannotSpecialSummon,
        luaTargetDescriptor: `target:not-setcode:${setChronomaly}`,
        property: 0x80800,
        sourceUid: sphinx.uid,
        targetRange: [1, 0],
      }),
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === revived.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: revived.uid,
        eventUids: [revived.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: sphinx.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredLocked);
    expectRestoredLegalActions(restoredLocked, 0);
    const offSetAction = getLuaRestoreLegalActions(restoredLocked, 0).find((action) => action.type === "activateEffect" && action.uid === offSetProbe.uid);
    expect(offSetAction, JSON.stringify(getLuaRestoreLegalActions(restoredLocked, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredLocked, offSetAction!);
    passRestoredChain(restoredLocked);
    expect(restoredLocked.session.state.cards.find((card) => card.uid === offSetProbe.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredLocked.host.messages).not.toContain("off-set hand probe resolved");

    const restoredAfterBlocked = restoreDuelWithLuaScripts(serializeDuel(restoredLocked.session), source, reader);
    expectCleanRestore(restoredAfterBlocked);
    expectRestoredLegalActions(restoredAfterBlocked, 0);
    const chronomalyAction = getLuaRestoreLegalActions(restoredAfterBlocked, 0).find((action) => action.type === "activateEffect" && action.uid === chronomalyProbe.uid);
    expect(chronomalyAction, JSON.stringify(getLuaRestoreLegalActions(restoredAfterBlocked, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAfterBlocked, chronomalyAction!);
    passRestoredChain(restoredAfterBlocked);
    expect(restoredAfterBlocked.session.state.cards.find((card) => card.uid === chronomalyProbe.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
    });
    expect(restoredAfterBlocked.host.messages).toContain("chronomaly hand probe resolved");
  });
});

function handSummonProbeScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        if Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)>0 then
          Debug.Message("${message} resolved")
        end
      end)
      c:RegisterEffect(e)
    end
  `;
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
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
