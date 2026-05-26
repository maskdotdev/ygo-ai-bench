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
const ulkaCode = "49109013";
const victimCode = "491090130";
const removerCode = "491090131";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUlkaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ulkaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUlkaScript)("Lua real script Doomstar Ulka leave self-banish summon stat", () => {
  it("restores opponent-effect leave-field trigger into self-banish cost and departed-monster summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ulkaCode}.lua`);
    expectScriptShape(script);
    const source = sourceWithRemover(workspace);
    const reader = createCardReader(cards());
    const restoredLeave = createRestoredUlkaField({ reader, source, workspace });
    expectCleanRestore(restoredLeave);
    expectRestoredLegalActions(restoredLeave, 1);
    const ulka = requireCard(restoredLeave.session, ulkaCode);
    const victim = requireCard(restoredLeave.session, victimCode);
    const remover = requireCard(restoredLeave.session, removerCode);

    const bounceVictim = getLuaRestoreLegalActions(restoredLeave, 1).find((action) =>
      action.type === "activateEffect" && action.uid === remover.uid
    );
    expect(bounceVictim, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, bounceVictim!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.session.state.cards.find((card) => card.uid === victim.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 1,
      reasonCardUid: remover.uid,
      reasonEffectId: 3,
    });
    const summonVictim = getLuaRestoreLegalActions(restoredLeave, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === ulka.uid
    );
    expect(summonVictim, JSON.stringify({
      actions: getLuaRestoreLegalActions(restoredLeave, 0),
      effects: restoredLeave.session.state.effects.filter((effect) => effect.sourceUid === ulka.uid),
      ulka: restoredLeave.session.state.cards.find((card) => card.uid === ulka.uid),
    }, null, 2)).toBeDefined();
    expect(summonVictim).toMatchObject({ effectId: "lua-1-1015", player: 0, uid: ulka.uid });
    applyRestoredActionAndAssert(restoredLeave, summonVictim!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.session.state.cards.find((card) => card.uid === ulka.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: ulka.uid,
      reasonEffectId: 1,
    });
    expect(restoredLeave.session.state.cards.find((card) => card.uid === victim.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ulka.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredLeave.session.state.cards.find((card) => card.uid === victim.uid), restoredLeave.session.state)).toBe(1800);
    expect(restoredLeave.session.state.eventHistory.filter((event) => ["becameTarget", "leftField", "sentToGraveyard", "banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventCardUid: victim.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "deck", current: "monsterZone", relatedEffectId: 3 },
      { eventCardUid: victim.uid, eventCode: 1015, eventName: "leftField", eventReason: duelReason.effect, eventReasonCardUid: remover.uid, eventReasonEffectId: 3, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: victim.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: remover.uid, eventReasonEffectId: 3, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: ulka.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: ulka.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "banished", relatedEffectId: undefined },
      { eventCardUid: victim.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: ulka.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone", relatedEffectId: undefined },
    ]);
    expect(restoredLeave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredUlkaField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 49109013, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [ulkaCode, victimCode] },
    1: { main: [removerCode] },
  });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, ulkaCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, victimCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, removerCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ulkaCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(removerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Doomstar Ulka");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
  expect(script).toContain("ec:IsPreviousLocation(LOCATION_MZONE) and ec:IsPreviousControler(tp) and ec:IsReason(REASON_EFFECT)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id,0,TYPE_MONSTER|TYPE_EFFECT,1500,400,4,RACE_BEAST,ATTRIBUTE_WIND)");
  expect(script).toContain("c:CreateEffectRelation(e)");
  expect(script).toContain("ec:CreateEffectRelation(e)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)");
}

function cards(): DuelCardData[] {
  return [
    { code: ulkaCode, name: "Doomstar Ulka", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeWind, level: 4, attack: 1500, defense: 400 },
    { code: victimCode, name: "Ulka Leave-Field Victim", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
    { code: removerCode, name: "Ulka Opponent Bouncer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function sourceWithRemover(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${removerCode}.lua`) return removerScript();
      return workspace.readScript(name);
    },
  };
}

function removerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_TOGRAVE)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and chkc:IsCode(${victimCode}) end
      if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${victimCode}) end
      local g=Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${victimCode})
      Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,1-tp,0)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then Duel.SendtoGrave(tc,REASON_EFFECT) end
      Debug.Message("ulka remover resolved")
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
