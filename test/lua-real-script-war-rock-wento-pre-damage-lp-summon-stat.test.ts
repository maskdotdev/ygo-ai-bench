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
const wentoCode = "47504322";
const defenderCode = "475043220";
const summonCode = "475043221";
const senderCode = "475043222";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWentoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wentoCode}.lua`));
const setWarRock = 0x161;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasWentoScript)("Lua real script War Rock Wento pre-damage LP summon stat", () => {
  it("restores pre-damage LP-cost ATK boost and opponent-effect to-Graveyard War Rock summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wentoCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = sourceWithSender(workspace);

    const restoredBattle = createRestoredWentoField({ reader, source, workspace, scenario: "battle" });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleWento = requireCard(restoredBattle.session, wentoCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleWento.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    advanceToWentoActivation(restoredBattle, battleWento.uid);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const boost = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) =>
      action.type === "activateEffect" && action.uid === battleWento.uid
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, boost!);
    resolveRestoredChain(restoredPreDamage);

    expect(restoredPreDamage.session.state.players[0].lifePoints).toBe(7200);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === battleWento.uid), restoredPreDamage.session.state)).toBe(2600);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === battleWento.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: battleWento.uid, value: 800 },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => ["beforeDamageCalculation", "lifePointCostPaid"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventName: "beforeDamageCalculation", eventCode: 1134, eventCardUid: battleWento.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventValue: undefined },
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: battleWento.uid, eventReasonEffectId: 1, eventValue: 800 },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), source, reader);
    expectCleanRestore(restoredBoost);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === battleWento.uid), restoredBoost.session.state)).toBe(2600);
    finishRestoredBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 1400 });

    const restoredRemoval = createRestoredWentoField({ reader, source, workspace, scenario: "toGrave" });
    expectCleanRestore(restoredRemoval);
    expectRestoredLegalActions(restoredRemoval, 1);
    const removedWento = requireCard(restoredRemoval.session, wentoCode);
    const sender = requireCard(restoredRemoval.session, senderCode);
    const summonTarget = requireCard(restoredRemoval.session, summonCode);
    const sendWento = getLuaRestoreLegalActions(restoredRemoval, 1).find((action) =>
      action.type === "activateEffect" && action.uid === sender.uid
    );
    expect(sendWento, JSON.stringify(getLuaRestoreLegalActions(restoredRemoval, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemoval, sendWento!);
    resolveRestoredChain(restoredRemoval);

    expect(restoredRemoval.session.state.cards.find((card) => card.uid === removedWento.uid)).toMatchObject({
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
        sourceUid: removedWento.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventPlayer: 0,
        eventCardUid: removedWento.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: sender.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const summon = getLuaRestoreLegalActions(restoredRemoval, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === removedWento.uid
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredRemoval, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemoval, summon!);
    resolveRestoredChain(restoredRemoval);

    expect(restoredRemoval.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: removedWento.uid,
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
      { eventCardUid: removedWento.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, relatedEffectId: 3 },
      { eventCardUid: removedWento.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: sender.uid, eventReasonEffectId: 3, eventReasonPlayer: 1, relatedEffectId: undefined },
      { eventCardUid: sender.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, relatedEffectId: undefined },
      { eventCardUid: summonTarget.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: removedWento.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
  });
});

function createRestoredWentoField({
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
  const session = createDuel({ seed: scenario === "battle" ? 47504322 : 47504323, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [wentoCode, summonCode] }, 1: { main: [defenderCode, senderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, wentoCode), 0, 0);
  if (scenario === "battle") {
    moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
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
  expect(host.loadCardScript(Number(wentoCode), source).ok).toBe(true);
  if (scenario === "toGrave") expect(host.loadCardScript(Number(senderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "toGrave" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("War Rock Wento");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetCost(Cost.PayLP(800))");
  expect(script).toContain("local bc0,bc1=Duel.GetBattleMonster(tp)");
  expect(script).toContain("bc0:IsAttribute(ATTRIBUTE_EARTH) and bc0:IsRace(RACE_WARRIOR)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetValue(800)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return rp==1-tp and c:IsReason(REASON_EFFECT) and c:IsPreviousControler(tp)");
  expect(script).toContain("return c:IsSetCard(SET_WAR_ROCK) and c:IsLevelAbove(5) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: wentoCode, name: "War Rock Wento", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1800, setcodes: [setWarRock] },
    { code: defenderCode, name: "War Rock Wento Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: summonCode, name: "War Rock Wento Level 5 Summon Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 5, attack: 2300, defense: 1900, setcodes: [setWarRock] },
    { code: senderCode, name: "War Rock Wento Opponent Sender", kind: "spell", typeFlags: typeSpell },
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

function advanceToWentoActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, wentoUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === wentoUid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
