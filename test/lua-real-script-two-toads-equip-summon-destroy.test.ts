import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const twoToadsCode = "6203182";
const targetCode = "62031820";
const responderCode = "62031821";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const categoryEquip = 0x40000;
const effectEquipLimit = 76;
const effectDisable = 2;
const effectDisableEffect = 8;
const effectCannotAttack = 85;
const effectCannotBeBattleTarget = 70;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Two Toads with One Sting equip summon destroy", () => {
  it("restores opponent Graveyard SpecialSummonStep into equip disable locks and target destroy when the equip leaves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${twoToadsCode}.lua`);
    expectScriptShape(script);
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === twoToadsCode),
      { code: targetCode, name: "Two Toads Fixture Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Two Toads Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 6203182, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [twoToadsCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const twoToads = requireCard(session, twoToadsCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, twoToads.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "graveyard", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(twoToadsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === twoToads.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain.map((link) => ({
      activationLocation: link.activationLocation,
      effectId: link.effectId,
      operationInfos: link.operationInfos,
      targetFieldIds: link.targetFieldIds,
      targetUids: link.targetUids,
    }))).toEqual([{
      activationLocation: "hand",
      effectId: "lua-1-1002",
      operationInfos: [
        { category: categorySpecialSummon, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
        { category: categoryEquip, targetUids: [twoToads.uid], count: 1, player: 0, parameter: 0 },
      ],
      targetFieldIds: [target.fieldId],
      targetUids: [target.uid],
    }]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);
    const summonedTarget = restoredChain.session.state.cards.find((card) => card.uid === target.uid)!;
    expect(restoredChain.host.messages).not.toContain("two toads responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === twoToads.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: target.uid,
      faceUp: true,
    });
    expect(summonedTarget).toMatchObject({
      controller: 1,
      location: "monsterZone",
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: twoToads.uid,
      reasonEffectId: 1,
    });
    expect(isCardDisabled(restoredChain.session.state, summonedTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === twoToads.uid || effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      reset: effect.reset,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: 1002, event: "ignition", sourceUid: twoToads.uid, reset: undefined, triggerEvent: undefined, value: undefined },
      { code: 1019, event: "continuous", sourceUid: twoToads.uid, reset: undefined, triggerEvent: "leftField", value: undefined },
      { code: 1015, event: "continuous", sourceUid: twoToads.uid, reset: undefined, triggerEvent: "leftField", value: undefined },
      { code: effectCannotAttack, event: "continuous", sourceUid: twoToads.uid, reset: undefined, triggerEvent: undefined, value: undefined },
      { code: effectCannotBeBattleTarget, event: "continuous", sourceUid: twoToads.uid, reset: undefined, triggerEvent: undefined, value: undefined },
      { code: 1014, event: "trigger", sourceUid: twoToads.uid, reset: undefined, triggerEvent: "sentToGraveyard", value: undefined },
      { code: effectEquipLimit, event: "continuous", sourceUid: twoToads.uid, reset: { flags: 33427456 }, triggerEvent: undefined, value: undefined },
      { code: effectDisable, event: "continuous", sourceUid: target.uid, reset: { flags: 33427456 }, triggerEvent: undefined, value: undefined },
      { code: effectDisableEffect, event: "continuous", sourceUid: target.uid, reset: { flags: 33427456 }, triggerEvent: undefined, value: undefined },
    ]);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    sendDuelCardToGraveyard(restoredEquipped.session.state, twoToads.uid, 0, duelReason.effect, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === twoToads.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target.uid,
    });
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: twoToads.uid,
      reasonEffectId: 3,
    });
    expect(restoredEquipped.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToGraveyard", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCardUid: target.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: twoToads.uid, eventReasonEffectId: 1 },
      { eventName: "destroyed", eventCardUid: target.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: twoToads.uid, eventReasonEffectId: 3 },
      { eventName: "sentToGraveyard", eventCardUid: target.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: twoToads.uid, eventReasonEffectId: 3 },
      { eventName: "sentToGraveyard", eventCardUid: twoToads.uid, eventReason: duelReason.effect, eventReasonCardUid: twoToads.uid, eventReasonEffectId: 1 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Two Toads with One Sting");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,1-tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.Equip(tp,c,tc)");
  expect(script).toContain("e0:SetCode(EFFECT_EQUIP_LIMIT)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e5:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
  expect(script).toContain("e5:SetValue(aux.imval1)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("two toads responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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
