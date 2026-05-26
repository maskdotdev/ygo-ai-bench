import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRaccoonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c31991800.lua"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const setMajespecter = 0xd0;

describe.skipIf(!hasUpstreamScripts || !hasRaccoonScript)("Lua real script Majespecter Raccoon summon search protection", () => {
  it("restores its summon search plus opponent targeting and destruction protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const raccoonCode = "31991800";
    const searchTargetCode = "31991801";
    const invalidSetSpellCode = "31991802";
    const vulnerableCode = "31991803";
    const responderCode = "31991804";
    const targeterCode = "31991805";
    const script = workspace.readScript(`c${raccoonCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SEARCH+CATEGORY_TOHAND)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e4:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e4:SetValue(aux.tgoval)");
    expect(script).toContain("e5:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("return tp~=e:GetHandlerPlayer()");
    expect(script).toContain("return c:IsSetCard(SET_MAJESPECTER) and c:IsMonster() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      {
        code: raccoonCode,
        name: "Majespecter Raccoon - Bunbuku",
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typePendulum,
        setcodes: [setMajespecter],
        level: 3,
        attack: 1200,
        defense: 900,
        leftScale: 5,
        rightScale: 5,
      },
      { code: searchTargetCode, name: "Majespecter Search Monster", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMajespecter], level: 4 },
      { code: invalidSetSpellCode, name: "Majespecter Invalid Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setMajespecter] },
      { code: vulnerableCode, name: "Majespecter Vulnerable Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Majespecter Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: targeterCode, name: "Majespecter Targeting Destroyer", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 31991800, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [raccoonCode, searchTargetCode, invalidSetSpellCode, vulnerableCode] }, 1: { main: [responderCode, targeterCode] } });
    startDuel(session);

    const raccoon = requireCard(session, raccoonCode);
    const searchTarget = requireCard(session, searchTargetCode);
    const invalidSetSpell = requireCard(session, invalidSetSpellCode);
    const vulnerable = requireCard(session, vulnerableCode);
    const responder = requireCard(session, responderCode);
    const targeter = requireCard(session, targeterCode);
    moveDuelCard(session.state, raccoon.uid, "hand", 0);
    const movedVulnerable = moveDuelCard(session.state, vulnerable.uid, "monsterZone", 0);
    movedVulnerable.faceUp = true;
    movedVulnerable.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    moveDuelCard(session.state, targeter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        if (name === `c${targeterCode}.lua`) return targetingDestroyerScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(raccoonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targeterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === raccoon.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1100",
        sourceUid: raccoon.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventPlayer: 0,
        eventCardUid: raccoon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === raccoon.uid && effect.code === 71)).toMatchObject({
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === raccoon.uid && effect.code === 41)).toMatchObject({
      luaValueDescriptor: "indestructible:opponent",
      range: ["monsterZone"],
    });

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === raccoon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3-1100",
        sourceUid: raccoon.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 1,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventPlayer: 0,
        eventCardUid: raccoon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const passSearch = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(passSearch).toBeDefined();
    applyLuaRestoreAndAssert(restoredChain, passSearch!);

    expect(restoredChain.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === invalidSetSpell.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.host.messages).toEqual([`confirmed 1: ${searchTargetCode}`]);
    expect(restoredChain.host.messages).not.toContain("majespecter responder resolved");
    expect(
      restoredChain.session.state.eventHistory.filter((event) =>
        ["normalSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName),
      ),
    ).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: raccoon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: raccoon.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: searchTarget.uid,
        eventPlayer: 1,
        eventUids: [searchTarget.uid],
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: raccoon.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: searchTarget.uid,
        eventPlayer: 1,
        eventUids: [searchTarget.uid],
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: raccoon.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    restoredChain.session.state.turnPlayer = 1;
    restoredChain.session.state.waitingFor = 1;
    restoredChain.session.state.phase = "main1";
    const restoredProtection = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredProtection);
    expectRestoredLegalActions(restoredProtection, 1);
    const targetingDestroy = getLuaRestoreLegalActions(restoredProtection, 1).find((action) => action.type === "activateEffect" && action.uid === targeter.uid);
    expect(targetingDestroy, JSON.stringify(getLuaRestoreLegalActions(restoredProtection, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredProtection, targetingDestroy!);
    expect(restoredProtection.session.state.chain[0]?.sourceUid).toBe(targeter.uid);
    expect(restoredProtection.session.state.chain[0]?.player).toBe(1);
    expect(restoredProtection.session.state.chain[0]?.targetUids).toEqual([vulnerable.uid]);
    expect(restoredProtection.session.state.chain[0]?.targetUids).not.toContain(raccoon.uid);
    expect(getLuaRestoreLegalActions(restoredProtection, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const passDestroy = getLuaRestoreLegalActions(restoredProtection, 1).find((action) => action.type === "passChain");
    expect(passDestroy).toBeDefined();
    applyLuaRestoreAndAssert(restoredProtection, passDestroy!);
    expect(restoredProtection.session.state.cards.find((card) => card.uid === vulnerable.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredProtection.session.state.cards.find((card) => card.uid === raccoon.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    const opponentDestroy = destroyDuelCard(restoredProtection.session.state, raccoon.uid, 1, duelReason.effect | duelReason.destroy, 1);
    expect(opponentDestroy).toMatchObject({ uid: raccoon.uid, location: "monsterZone", controller: 0 });
    const ownerDestroy = destroyDuelCard(restoredProtection.session.state, raccoon.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(ownerDestroy).toMatchObject({ uid: raccoon.uid, location: "extraDeck", controller: 0, faceUp: true });
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("majespecter responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function targetingDestroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(s.tg)
      e:SetOperation(s.op)
      c:RegisterEffect(e)
    end
    function s.filter(c)
      return c:IsFaceup()
    end
    function s.tg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and s.filter(chkc) end
      if chk==0 then return Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
      local g=Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
    end
    function s.op(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then
        Debug.Message("majespecter targeter destroyed " .. Duel.Destroy(tc,REASON_EFFECT))
      end
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
