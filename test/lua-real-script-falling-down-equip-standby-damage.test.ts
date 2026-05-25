import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const fallingCode = "32919136";
const archfiendCode = "329191360";
const stealTargetCode = "329191361";
const responderCode = "329191362";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFallingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fallingCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const typeEffect = 0x20;
const setArchfiend = 0x45;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const categoryDamage = 0x80000;
const categoryControl = 0x2000;
const categoryEquip = 0x40000;
const effectFlagSingleRange = 131072;
const effectSelfDestroy = 141;
const effectEquipLimit = 76;
const effectSetControl = 4;

describe.skipIf(!hasUpstreamScripts || !hasFallingScript)("Lua real script Falling Down equip standby damage", () => {
  it("restores steal equip control and opponent Standby CHAININFO damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fallingCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 32919136, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fallingCode, archfiendCode] }, 1: { main: [stealTargetCode, responderCode] } });
    startDuel(session);

    const falling = requireCard(session, fallingCode);
    const archfiend = requireCard(session, archfiendCode);
    const stealTarget = requireCard(session, stealTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, falling.uid, "hand", 0);
    moveFaceUpAttack(session, archfiend, 0, 0);
    moveFaceUpAttack(session, stealTarget, 1, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fallingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const equip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === falling.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, equip!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]!.operationInfos).toEqual([
      { category: categoryControl, targetUids: [stealTarget.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x40000, targetUids: [falling.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const restoredEquipChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredEquipChain);
    expectRestoredLegalActions(restoredEquipChain, 1);
    expect(getLuaRestoreLegalActions(restoredEquipChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredEquipChain);
    expect(restoredEquipChain.host.messages).not.toContain("falling down responder resolved");
    expect(restoredEquipChain.session.state.cards.find((card) => card.uid === falling.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: stealTarget.uid,
      faceUp: true,
    });
    expect(restoredEquipChain.session.state.cards.find((card) => card.uid === stealTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
    });
    expect(restoredEquipChain.session.state.effects.filter((effect) => effect.sourceUid === falling.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryEquip, code: 1002, countLimit: undefined, event: "ignition", property: 134217744, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectEquipLimit, countLimit: undefined, event: "continuous", property: 1024, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: categoryDamage, code: 4098, countLimit: 1, event: "trigger", property: undefined, range: ["spellTrapZone"], triggerEvent: "phaseStandby" },
      { category: undefined, code: effectSelfDestroy, countLimit: undefined, event: "continuous", property: effectFlagSingleRange, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectSetControl, countLimit: undefined, event: "continuous", property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);

    restoredEquipChain.session.state.turn = 2;
    restoredEquipChain.session.state.turnPlayer = 1;
    restoredEquipChain.session.state.phase = "draw";
    restoredEquipChain.session.state.waitingFor = 1;
    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredEquipChain.session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 1);
    const standby = getLuaRestoreLegalActions(restoredDraw, 1).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-3-4098",
        sourceUid: falling.uid,
        eventName: "phaseStandby",
        eventCode: 4098,
        eventTriggerTiming: "when",
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === falling.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.map((link) => ({
      effectId: link.effectId,
      sourceUid: link.sourceUid,
      player: link.player,
      targetPlayer: link.targetPlayer,
      targetParam: link.targetParam,
      operationInfos: link.operationInfos,
    }))).toEqual([
      {
      effectId: "lua-3-4098",
        sourceUid: falling.uid,
        player: 0,
        targetPlayer: 0,
        targetParam: 800,
        operationInfos: [{ category: categoryDamage, targetUids: [], count: 0, player: 0, parameter: 800 }],
      },
    ]);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredDamage);
    expectRestoredLegalActions(restoredDamage, 1);
    passRestoredChain(restoredDamage);
    expect(restoredDamage.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredDamage.session.state.cards.find((card) => card.uid === falling.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: stealTarget.uid,
    });
    expect(restoredDamage.session.state.eventHistory.filter((event) => ["becameTarget", "controlChanged", "phaseStandby", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: stealTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: stealTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: falling.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      { eventName: "phaseStandby", eventCode: 4098 },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: falling.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(restoredDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Falling Down");
  expect(script).toContain("aux.AddEquipProcedure(c,1,aux.CheckStealEquip,s.eqlimit,nil,s.target)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,tc,1,0,0)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DAMAGE)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(800)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");
  expect(script).toContain("e3:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return not Duel.IsExistingMatchingCard(s.desfilter,e:GetHandlerPlayer(),LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("e5:SetCode(EFFECT_SET_CONTROL)");
}

function cards(): DuelCardData[] {
  return [
    { code: fallingCode, name: "Falling Down", kind: "spell", typeFlags: typeSpell | typeEquip, setcodes: [setArchfiend] },
    { code: archfiendCode, name: "Falling Down Archfiend Anchor", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000, setcodes: [setArchfiend] },
    { code: stealTargetCode, name: "Falling Down Steal Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: responderCode, name: "Falling Down Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("falling down responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
