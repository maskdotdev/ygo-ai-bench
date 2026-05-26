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
const filiaCode = "78293584";
const diabellSummonCode = "782935840";
const banisherCode = "782935841";
const opponentMonsterCode = "782935842";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFiliaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${filiaCode}.lua`));
const setDiabell = 0x203;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceSpellcaster = 0x10;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFiliaScript)("Lua real script Filia Diabell search summon banish attack stat", () => {
  it("restores ToHandOrElse Special Summon branch and banished trigger Diabell ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${filiaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 78293584, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [filiaCode, diabellSummonCode, banisherCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const filia = requireCard(session, filiaCode);
    const summonedDiabell = requireCard(session, diabellSummonCode);
    const banisher = requireCard(session, banisherCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, filia.uid, "hand", 0);
    moveDuelCard(session.state, banisher.uid, "hand", 0);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${banisherCode}.lua`) return banishFiliaScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(filiaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(banisherCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }],
    });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activateFilia = getLuaRestoreLegalActions(restoredActivation, 0).find((action) =>
      action.type === "activateEffect" && action.uid === filia.uid
    );
    expect(activateFilia, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activateFilia!);
    resolveRestoredChain(restoredActivation);

    expect(restoredActivation.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption")).toEqual([
      { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [573, 1252697347], returned: 1 },
    ]);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === summonedDiabell.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: filia.uid,
      reasonEffectId: 1,
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === filia.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredActivation.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: summonedDiabell.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: filia.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: filia.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const restoredBanishWindow = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader, {
      promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }],
    });
    expectCleanRestore(restoredBanishWindow);
    expectRestoredLegalActions(restoredBanishWindow, 0);
    const banishFilia = getLuaRestoreLegalActions(restoredBanishWindow, 0).find((action) =>
      action.type === "activateEffect" && action.uid === banisher.uid
    );
    expect(banishFilia, JSON.stringify(getLuaRestoreLegalActions(restoredBanishWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBanishWindow, banishFilia!);
    resolveRestoredChain(restoredBanishWindow);

    expect(restoredBanishWindow.session.state.cards.find((card) => card.uid === filia.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: banisher.uid,
      reasonEffectId: 3,
    });
    expect(restoredBanishWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-8-1",
        effectId: "lua-2-1011",
        sourceUid: filia.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "banished",
        eventCode: 1011,
        eventPlayer: 0,
        eventCardUid: filia.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: banisher.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredBanishWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === filia.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBanishWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBanishWindow, trigger!);
    resolveRestoredChain(restoredBanishWindow);

    expect(currentAttack(restoredBanishWindow.session.state.cards.find((card) => card.uid === summonedDiabell.uid), restoredBanishWindow.session.state)).toBe(3000);
    expect(restoredBanishWindow.session.state.effects.filter((effect) => effect.sourceUid === summonedDiabell.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 1024, reset: { flags: 33427456 }, sourceUid: summonedDiabell.uid, value: 500 },
    ]);
    expect(restoredBanishWindow.session.state.eventHistory.filter((event) => ["becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: filia.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 3 },
      { eventCardUid: filia.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: banisher.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredBanishWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Filia Diabell");
  expect(script).toContain("CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SPECIAL_SUMMON");
  expect(script).toContain("EFFECT_TYPE_ACTIVATE");
  expect(script).toContain("EVENT_FREE_CHAIN");
  expect(script).toContain("return c:IsSetCard(SET_DIABELL) and c:IsLevelAbove(8)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==0");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>0");
  expect(script).toContain("aux.ToHandOrElse(sc,tp,");
  expect(script).toContain("Duel.SpecialSummon(sc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SendtoHand(sc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sc)");
  expect(script).toContain("CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O");
  expect(script).toContain("EFFECT_FLAG_DELAY");
  expect(script).toContain("EVENT_REMOVE");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_DIABELL),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("EFFECT_FLAG_CANNOT_DISABLE");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const filia = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === filiaCode);
  expect(filia).toBeDefined();
  return [
    { ...filia!, kind: "spell", typeFlags: typeSpell },
    { code: diabellSummonCode, name: "Filia Diabell Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 8, attack: 2500, defense: 2000, setcodes: [setDiabell] },
    { code: banisherCode, name: "Filia Fixture Banisher", kind: "spell", typeFlags: typeSpell },
    { code: opponentMonsterCode, name: "Filia Opponent Field Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1200 },
  ];
}

function banishFiliaScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_REMOVE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(tp) and chkc:IsLocation(LOCATION_GRAVE|LOCATION_SZONE) and chkc:IsCode(${filiaCode}) end
      if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,LOCATION_GRAVE|LOCATION_SZONE,0,1,nil,${filiaCode}) end
      local g=Duel.SelectTarget(tp,Card.IsCode,tp,LOCATION_GRAVE|LOCATION_SZONE,0,1,1,nil,${filiaCode})
      Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,1,tp,0)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then
        Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)
      end
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
