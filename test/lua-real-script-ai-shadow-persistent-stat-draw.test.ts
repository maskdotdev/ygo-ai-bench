import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const aiShadowCode = "77421977";
const hasAiShadowScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aiShadowCode}.lua`));
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const typeMonster = 0x1;
const typeEffect = 0x20;
const setIgnister = 0x135;

describe.skipIf(!hasUpstreamScripts || !hasAiShadowScript)("Lua real script A.I. Shadow persistent stat draw", () => {
  it("restores persistent @Ignister targeting, must-attack effects, and opponent-effect removal draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "774219770";
    const destroyerCode = "774219771";
    const drawCode = "774219772";
    const responderCode = "774219773";
    const script = workspace.readScript(`c${aiShadowCode}.lua`);
    expect(script).toContain("aux.AddPersistentProcedure(c,0,aux.FaceupFilter(Card.IsSetCard,SET_IGNISTER),CATEGORY_ATKCHANGE,EFFECT_FLAG_DAMAGE_STEP");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(aux.PersistentTargetFilter)");
    expect(script).toContain("e2:SetCode(EFFECT_MUST_ATTACK)");
    expect(script).toContain("e3:SetCode(EFFECT_MUST_ATTACK_MONSTER)");
    expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("e5:SetCode(EVENT_REMOVE)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");

    const cards: DuelCardData[] = [
      { code: aiShadowCode, name: "A.I. Shadow", kind: "trap", typeFlags: typeTrap | typeContinuous },
      { code: targetCode, name: "A.I. Shadow @Ignister Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setIgnister], level: 4, attack: 1500, defense: 1000 },
      { code: destroyerCode, name: "A.I. Shadow Opponent Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1200 },
      { code: drawCode, name: "A.I. Shadow Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "A.I. Shadow Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 77421977, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [aiShadowCode, targetCode, drawCode] }, 1: { main: [destroyerCode, responderCode] } });
    startDuel(session);

    const shadow = requireCard(session, aiShadowCode);
    const target = requireCard(session, targetCode);
    const destroyer = requireCard(session, destroyerCode);
    const draw = requireCard(session, drawCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, shadow.uid, "spellTrapZone", 0);
    shadow.position = "faceDown";
    shadow.faceUp = false;
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 1).position = "faceUpAttack";
    destroyer.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = realAiShadowWithLocalSupport(workspace, destroyerCode, responderCode, aiShadowCode);
    const host = createLuaScriptHost(session, workspace);
    for (const code of [aiShadowCode, destroyerCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === shadow.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === shadow.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("ai shadow responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(2300);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === shadow.uid && effect.code === 191)).toHaveLength(1);
    const mustAttackMonsterEffects = restoredChain.session.state.effects.filter((effect) => effect.sourceUid === shadow.uid && effect.code === 344);
    expect(mustAttackMonsterEffects).toHaveLength(1);
    expect(mustAttackMonsterEffects[0]?.range).toContain("spellTrapZone");
    expect(typeof mustAttackMonsterEffects[0]?.valueCardPredicate).toBe("function");
    expectAiShadowProbe(restoredChain, aiShadowCode, targetCode, "ai shadow persistent true/true/1/2300");

    restoredChain.session.state.turnPlayer = 1;
    restoredChain.session.state.waitingFor = 1;
    restoredChain.session.state.phase = "main1";
    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 1);
    const destroyAction = getLuaRestoreLegalActions(restoredDestroy, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDestroy, destroyAction!);
    resolveRestoredChain(restoredDestroy);
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === shadow.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroy.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === shadow.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain[0]).toEqual({
      activationLocation: "graveyard",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-6-1014",
      eventCardUid: shadow.uid,
      eventCode: 1014,
      eventCurrentState: {
        controller: 0,
        faceUp: true,
        location: "graveyard",
        position: "faceDown",
        sequence: 0,
      },
      eventName: "sentToGraveyard",
      eventPlayer: 0,
      eventPreviousState: {
        controller: 0,
        faceUp: true,
        location: "spellTrapZone",
        position: "faceDown",
        sequence: 0,
      },
      eventReason: duelReason.effect | duelReason.destroy,
      eventReasonCardUid: destroyer.uid,
      eventReasonEffectId: 8,
      eventReasonPlayer: 1,
      eventTriggerTiming: "if",
      id: "chain-8",
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
      player: 0,
      sourceUid: shadow.uid,
      targetParam: 1,
      targetPlayer: 0,
    });

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 1);
    resolveRestoredChain(restoredDraw);
    expect(restoredDraw.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredDraw.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [draw.uid],
        eventCardUid: draw.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shadow.uid,
        eventReasonEffectId: 6,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredDraw.host.messages).not.toContain("ai shadow responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function realAiShadowWithLocalSupport(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  destroyerCode: string,
  responderCode: string,
  aiShadowCode: string,
) {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript(aiShadowCode);
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(aiShadowCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${aiShadowCode}),tp,0,LOCATION_SZONE,nil)
        Duel.Destroy(tc,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("ai shadow responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectAiShadowProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, aiShadowCode: string, targetCode: string, message: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${aiShadowCode}),0,LOCATION_SZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message(
        "ai shadow persistent " ..
        tostring(trap:IsHasCardTarget(target)) .. "/" ..
        tostring(aux.PersistentTargetFilter(e,target)) .. "/" ..
        trap:GetCardTargetCount() .. "/" ..
        target:GetAttack()
      )
    `,
    "ai-shadow-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(message);
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
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
