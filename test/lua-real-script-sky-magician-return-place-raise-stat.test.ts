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
const skyMagicianCode = "73734821";
const returnSpellCode = "737348210";
const placeSpellCode = "737348211";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSkyMagicianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${skyMagicianCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const raceSpellcaster = 0x2;
const attributeWind = 0x8;
const setMagician = 0x98;

describe.skipIf(!hasUpstreamScripts || !hasSkyMagicianScript)("Lua real script Sky Magician return place raise stat", () => {
  it("restores Continuous Spell return, optional hand placement, raised custom event, and ATK trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${skyMagicianCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("local e2=e1:Clone()");
    expect(script).toContain("e2:SetCode(id)");
    expect(script).toContain("e1:SetValue(300)");
    expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsContinuousSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_SZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,1,0,0)");
    expect(script).toContain("return c:IsSetCard(SET_MAGICIAN) and c:IsContinuousSpell() and c:GetActivateEffect():IsActivatable(tp,true)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)>0");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.MoveToField(sc,tp,tp,LOCATION_SZONE,POS_FACEUP,true)");
    expect(script).toContain("local te=sc:GetActivateEffect()");
    expect(script).toContain("local cost=te:GetCost()");
    expect(script).toContain("if cost then cost(te,tep,eg,ep,ev,re,r,rp,1) end");
    expect(script).toContain("Duel.RaiseEvent(sc,id,te,0,tp,tp,Duel.GetCurrentChain())");
    expect(script).toContain("e4:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("return e:GetHandler():IsPreviousPosition(POS_FACEUP) and not e:GetHandler():IsLocation(LOCATION_DECK)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 73734821, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [skyMagicianCode, returnSpellCode, placeSpellCode] }, 1: { main: [] } });
    startDuel(session);
    const skyMagician = requireCard(session, skyMagicianCode);
    const returnSpell = requireCard(session, returnSpellCode);
    const placeSpell = requireCard(session, placeSpellCode);
    moveFaceUpAttack(session, skyMagician, 0);
    moveFaceUpSpell(session, returnSpell, 0);
    moveDuelCard(session.state, placeSpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${placeSpellCode}.lua`) return magicianContinuousSpellScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skyMagicianCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(placeSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === skyMagician.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.host.messages).toContain("sky magician placed spell cost checked");
    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1179757138, returned: true },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === returnSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: skyMagician.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === placeSpell.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });

    const restoredRaised = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredRaised);
    expectRestoredLegalActions(restoredRaised, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredRaised, 0).find((action) => action.type === "activateTrigger" && action.uid === skyMagician.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredRaised, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRaised, statTrigger!);
    passRestoredChain(restoredRaised);

    expect(currentAttack(restoredRaised.session.state.cards.find((card) => card.uid === skyMagician.uid), restoredRaised.session.state)).toBe(2800);
    expect(restoredRaised.session.state.effects.filter((effect) => effect.sourceUid === skyMagician.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33492992 }, value: 300 },
    ]);
    expect(restoredRaised.session.state.eventHistory.filter((event) => ["becameTarget", "sentToHand", "breakEffect", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      eventChainLinkId: event.eventChainLinkId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: returnSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, eventChainLinkId: "chain-2", previousLocation: "deck", currentLocation: "spellTrapZone" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: returnSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: skyMagician.uid, eventReasonEffectId: 3, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: "spellTrapZone", currentLocation: "hand" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: skyMagician.uid, eventReasonEffectId: 3, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, eventChainLinkId: "chain-2", previousLocation: undefined, currentLocation: undefined },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, eventChainLinkId: "chain-5", previousLocation: undefined, currentLocation: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: skyMagicianCode, name: "Performapal Sky Magician", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWind, level: 7, attack: 2500, defense: 2000 },
    { code: returnSpellCode, name: "Sky Magician Return Spell", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: placeSpellCode, name: "Sky Magician Placed Spell", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setMagician] },
  ];
}

function magicianContinuousSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Debug.Message("sky magician placed spell cost checked")
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
