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
const kuribohCode = "14965712";
const searchTargetCode = "149657120";
const handFillerCode = "149657121";
const opponentCode = "149657122";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKuribohScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kuribohCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasKuribohScript)("Lua real script Multiplying Kuriboh chain summon search zero stat", () => {
  it("restores opponent monster chain response into hand summon, ToHandOrElse search, ShuffleHand, and ATK zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${kuribohCode}.lua`));
    const source = sourceWithOpponent(workspace);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredKuribohField({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const kuriboh = requireCard(restoredOpen.session, kuribohCode);
    const opponent = requireCard(restoredOpen.session, opponentCode);

    const firstOpponentEffect = getLuaRestoreLegalActions(restoredOpen, 1).find((action) =>
      action.type === "activateEffect" && action.uid === opponent.uid
    );
    expect(firstOpponentEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, firstOpponentEffect!);

    expectRestoredLegalActions(restoredOpen, 0);
    const handSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === kuriboh.uid && action.effectId === "lua-1-1027"
    );
    expect(handSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, handSummon!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === kuriboh.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: kuriboh.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.host.messages).toContain("multiplying kuriboh opponent effect resolved");
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["chainActivating", "specialSummoned", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: opponent.uid, eventChainDepth: undefined, eventChainLinkId: undefined, eventCode: 1021, eventName: "chainActivating", eventPlayer: 1, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "deck", current: "monsterZone", relatedEffectId: 5 },
      { eventCardUid: kuriboh.uid, eventChainDepth: undefined, eventChainLinkId: undefined, eventCode: 1021, eventName: "chainActivating", eventPlayer: 0, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "hand", relatedEffectId: 1 },
      { eventCardUid: kuriboh.uid, eventChainDepth: undefined, eventChainLinkId: undefined, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: kuriboh.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", current: "monsterZone", relatedEffectId: undefined },
      { eventCardUid: undefined, eventChainDepth: 2, eventChainLinkId: "chain-3", eventCode: 1022, eventName: "chainSolved", eventPlayer: 0, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: undefined, current: undefined, relatedEffectId: 1 },
      { eventCardUid: undefined, eventChainDepth: 1, eventChainLinkId: "chain-2", eventCode: 1022, eventName: "chainSolved", eventPlayer: 1, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: undefined, current: undefined, relatedEffectId: 5 },
    ]);

    const restoredField = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, {
      promptOverrides: [
        { api: "SelectOption", player: 0, returned: 0 },
        { api: "SelectYesNo", player: 0, returned: true },
      ],
    });
    expectCleanRestore(restoredField);
    expectRestoredLegalActions(restoredField, 1);
    const secondOpponentEffect = getLuaRestoreLegalActions(restoredField, 1).find((action) =>
      action.type === "activateEffect" && action.uid === opponent.uid
    );
    expect(secondOpponentEffect, JSON.stringify(getLuaRestoreLegalActions(restoredField, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, secondOpponentEffect!);

    expectRestoredLegalActions(restoredField, 0);
    const searchAndZero = getLuaRestoreLegalActions(restoredField, 0).find((action) =>
      action.type === "activateEffect" && action.uid === kuriboh.uid && action.effectId === "lua-3-1027"
    );
    expect(searchAndZero, JSON.stringify(getLuaRestoreLegalActions(restoredField, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, searchAndZero!);
    resolveRestoredChain(restoredField);

    const searchTarget = requireCard(restoredField.session, searchTargetCode);
    expect(restoredField.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: kuriboh.uid,
      reasonEffectId: 3,
    });
    expect(restoredField.host.promptDecisions.filter((prompt) => ["SelectOption", "SelectYesNo"].includes(prompt.api)).map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([
      { api: "SelectOption", player: 0, returned: 0 },
      { api: "SelectYesNo", player: 0, returned: true },
    ]);
    expect(currentAttack(restoredField.session.state.cards.find((card) => card.uid === opponent.uid), restoredField.session.state)).toBe(0);
    expect(restoredField.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: opponent.uid, value: 0 },
    ]);
    expect(restoredField.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: kuriboh.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: kuriboh.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: kuriboh.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: kuriboh.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: undefined, current: undefined },
    ]);
    expect(restoredField.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredKuribohField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 14965712, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [kuribohCode, searchTargetCode, handFillerCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, kuribohCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, handFillerCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(kuribohCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(opponentCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Multiplying Kuriboh!");
  expect(script).toContain("e1a:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1a:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1a:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e1a:SetRange(LOCATION_HAND)");
  expect(script).toContain("return ep==1-tp and re:IsMonsterEffect()");
  expect(script).toContain("e1b:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return Duel.GetAttacker():IsControler(1-tp)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2a:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2a:SetCountLimit(1,0,EFFECT_COUNT_CODE_SINGLE)");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)&LOCATION_MZONE>0");
  expect(script).toContain("e2b:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("return (c:IsCode(CARD_DARK_MAGICIAN) or (c:IsAttack(300) and c:IsDefense(200)))");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thspfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp,mmz_chk):GetFirst()");
  expect(script).toContain("aux.ToHandOrElse(sc,tp,");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("Duel.IsDamageStep()");
  expect(script).toContain("opp_card=re:GetHandler()");
  expect(script).toContain("relation_chk=opp_card:IsRelateToEffect(re)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,4))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: kuribohCode, name: "Multiplying Kuriboh!", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200 },
    { code: searchTargetCode, name: "Multiplying Kuriboh Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200 },
    { code: handFillerCode, name: "Multiplying Kuriboh Hand Filler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200 },
    { code: opponentCode, name: "Multiplying Kuriboh Opponent Effect Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1200 },
  ];
}

function sourceWithOpponent(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${opponentCode}.lua`) return opponentScript();
      return workspace.readScript(name);
    },
  };
}

function opponentScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function()
        Debug.Message("multiplying kuriboh opponent effect resolved")
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
