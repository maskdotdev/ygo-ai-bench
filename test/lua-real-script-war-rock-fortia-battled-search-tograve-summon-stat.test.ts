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
const fortiaCode = "83286340";
const searchCode = "832863400";
const allyCode = "832863401";
const defenderCode = "832863402";
const summonCode = "832863403";
const senderCode = "832863404";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFortiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fortiaCode}.lua`));
const setWarRock = 0x161;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFortiaScript)("Lua real script War Rock Fortia battled search tograve summon stat", () => {
  it("restores battle search ATK gain and opponent-effect to-Graveyard War Rock summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fortiaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const source = sourceWithSender(workspace);

    const restoredBattle = createRestoredFortiaField({ reader, source, workspace, scenario: "battle" });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleFortia = requireCard(restoredBattle.session, fortiaCode);
    const searchTarget = requireCard(restoredBattle.session, searchCode);
    const ally = requireCard(restoredBattle.session, allyCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleFortia.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle);

    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventUids: trigger.eventUids,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1138", eventCardUid: battleFortia.uid, eventCode: 1138, eventName: "afterDamageCalculation", eventUids: [battleFortia.uid, defender.uid], player: 0, sourceUid: battleFortia.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === battleFortia.uid
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchTrigger!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: battleFortia.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(currentAttack(restoredSearch.session.state.cards.find((card) => card.uid === battleFortia.uid), restoredSearch.session.state)).toBe(1900);
    expect(currentAttack(restoredSearch.session.state.cards.find((card) => card.uid === ally.uid), restoredSearch.session.state)).toBe(1400);
    expect(restoredSearch.session.state.effects.filter((effect) => [battleFortia.uid, ally.uid].includes(effect.sourceUid ?? "") && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x400, reset: { flags: 1644040704 }, sourceUid: battleFortia.uid, value: 200 },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, reset: { flags: 1644040704 }, sourceUid: ally.uid, value: 200 },
    ]);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["afterDamageCalculation", "sentToHand", "confirmed", "sentToHandConfirmed", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: battleFortia.uid, eventCode: 1138, eventName: "afterDamageCalculation", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: battleFortia.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: battleFortia.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: battleFortia.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: battleFortia.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);

    const restoredRemoval = createRestoredFortiaField({ reader, source, workspace, scenario: "toGrave" });
    expectCleanRestore(restoredRemoval);
    expectRestoredLegalActions(restoredRemoval, 1);
    const removedFortia = requireCard(restoredRemoval.session, fortiaCode);
    const sender = requireCard(restoredRemoval.session, senderCode);
    const summonTarget = requireCard(restoredRemoval.session, summonCode);
    const sendFortia = getLuaRestoreLegalActions(restoredRemoval, 1).find((action) =>
      action.type === "activateEffect" && action.uid === sender.uid
    );
    expect(sendFortia, JSON.stringify(getLuaRestoreLegalActions(restoredRemoval, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemoval, sendFortia!);
    resolveRestoredChain(restoredRemoval);

    expect(restoredRemoval.session.state.cards.find((card) => card.uid === removedFortia.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 1,
      reasonCardUid: sender.uid,
      reasonEffectId: 3,
    });
    expect(restoredRemoval.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-1014",
        sourceUid: removedFortia.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventPlayer: 0,
        eventCardUid: removedFortia.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: sender.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const toGraveTrigger = getLuaRestoreLegalActions(restoredRemoval, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === removedFortia.uid
    );
    expect(toGraveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredRemoval, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemoval, toGraveTrigger!);
    resolveRestoredChain(restoredRemoval);

    expect(restoredRemoval.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: removedFortia.uid,
      reasonEffectId: 2,
    });
    expect(restoredRemoval.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: removedFortia.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, relatedEffectId: 3 },
      { eventCardUid: removedFortia.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: sender.uid, eventReasonEffectId: 3, eventReasonPlayer: 1, relatedEffectId: undefined },
      { eventCardUid: sender.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, relatedEffectId: undefined },
      { eventCardUid: summonTarget.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: removedFortia.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredRemoval.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredFortiaField({
  reader,
  source,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "battle" | "toGrave";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "battle" ? 83286340 : 83286341, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [fortiaCode, searchCode, allyCode, summonCode] }, 1: { main: [defenderCode, senderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, fortiaCode), 0, 0);
  if (scenario === "battle") {
    moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
    moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
    moveDuelCard(session.state, requireCard(session, summonCode).uid, "hand", 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
  } else {
    moveDuelCard(session.state, requireCard(session, senderCode).uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;
  }
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(fortiaCode), source).ok).toBe(true);
  if (scenario === "toGrave") expect(host.loadCardScript(Number(senderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "toGrave" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("War Rock Fortia");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLED)");
  expect(script).toContain("local bc=Duel.GetBattleMonster(tp)");
  expect(script).toContain("return bc and bc:IsAttribute(ATTRIBUTE_EARTH) and bc:IsRace(RACE_WARRIOR)");
  expect(script).toContain("return c:IsSetCard(SET_WAR_ROCK) and c:IsAbleToHand() and not c:IsCode(id)");
  expect(script).toContain("return c:IsSetCard(SET_WAR_ROCK) and c:IsFaceup() and not c:IsStatus(STATUS_BATTLE_DESTROYED)");
  expect(script).toContain("Duel.SendtoHand(sg,tp,REASON_EFFECT)>0");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
  expect(script).toContain("Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return rp==1-tp and c:IsReason(REASON_EFFECT) and c:IsPreviousControler(tp)");
  expect(script).toContain("return c:IsSetCard(SET_WAR_ROCK) and c:IsLevelAbove(5) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const fortia = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === fortiaCode);
  expect(fortia).toBeDefined();
  return [
    fortia!,
    { code: searchCode, name: "War Rock Fortia Search Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000, setcodes: [setWarRock] },
    { code: allyCode, name: "War Rock Fortia Ally Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000, setcodes: [setWarRock] },
    { code: defenderCode, name: "War Rock Fortia Defender Fixture", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: summonCode, name: "War Rock Fortia Level 5 Summon Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 5, attack: 2300, defense: 1900, setcodes: [setWarRock] },
    { code: senderCode, name: "War Rock Fortia Opponent Sender", kind: "spell", typeFlags: typeSpell },
  ];
}

function sourceWithSender(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${senderCode}.lua`) return senderScript();
      return workspace.readScript(name);
    },
  };
}

function senderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_TOGRAVE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) end
        if chk==0 then return Duel.IsExistingTarget(Card.IsMonster,tp,0,LOCATION_MZONE,1,nil) end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
        local g=Duel.SelectTarget(tp,Card.IsMonster,tp,0,LOCATION_MZONE,1,1,nil)
        Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,0,0)
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then Duel.SendtoGrave(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
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

function passUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
