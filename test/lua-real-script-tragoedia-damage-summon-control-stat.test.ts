import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const tragoediaCode = "98777036";
const attackerCode = "987770360";
const controlCostCode = "987770361";
const handFillerCode = "987770362";
const controlTargetCode = "987770363";
const responderCode = "987770364";
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDark = 0x20;
const raceFiend = 0x8;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tragoedia damage summon control stat", () => {
  it("restores battle-damage hand summon, hand-count stats, and level-cost control ignition", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tragoediaCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.GetFieldGroupCount(c:GetControler(),LOCATION_HAND,0)*600");
    expect(script).toContain("Duel.SendtoGrave(sg,REASON_COST)");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const tragoedia = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === tragoediaCode);
    expect(tragoedia).toBeDefined();
    const cards: DuelCardData[] = [
      tragoedia!,
      { code: attackerCode, name: "Tragoedia Fixture Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: controlCostCode, name: "Tragoedia Level Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
      { code: handFillerCode, name: "Tragoedia Hand Filler", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 700, defense: 700 },
      { code: controlTargetCode, name: "Tragoedia Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1200 },
      { code: responderCode, name: "Tragoedia Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 500, defense: 500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 98777036, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tragoediaCode, controlCostCode, handFillerCode] }, 1: { main: [attackerCode, controlTargetCode, responderCode] } });
    startDuel(session);

    const tragedy = requireCard(session, tragoediaCode);
    const attacker = requireCard(session, attackerCode);
    const controlCost = requireCard(session, controlCostCode);
    const handFiller = requireCard(session, handFillerCode);
    const controlTarget = requireCard(session, controlTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, tragedy.uid, "hand", 0);
    moveDuelCard(session.state, controlCost.uid, "hand", 0);
    moveDuelCard(session.state, handFiller.uid, "hand", 0);
    moveFaceUpAttack(session, attacker, 1);
    moveFaceUpAttack(session, controlTarget, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tragoediaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === tragedy.uid && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaValueDescriptor: effect.luaValueDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", luaValueDescriptor: "stat:controller-field-group-count:2:0:x600", range: ["monsterZone"], sourceUid: tragedy.uid },
      { code: effectUpdateDefense, event: "continuous", luaValueDescriptor: "stat:controller-field-group-count:2:0:x600", range: ["monsterZone"], sourceUid: tragedy.uid },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.directAttack,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.players[0]!.lifePoints).toBe(7000);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        effectId: "lua-1-1143",
        eventCardUid: attacker.uid,
        eventName: "battleDamageDealt",
        eventPlayer: 0,
        eventReason: duelReason.battle,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 1,
        eventValue: 1000,
        player: 0,
        sourceUid: tragedy.uid,
      }),
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tragedy.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === tragedy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: tragedy.uid,
      reasonEffectId: 1,
    });
    const summonedTragedy = restoredTrigger.session.state.cards.find((card) => card.uid === tragedy.uid)!;
    expect(currentAttack(summonedTragedy, restoredTrigger.session.state)).toBe((tragedy.data.attack ?? 0) + 1200);
    expect(currentDefense(summonedTragedy, restoredTrigger.session.state)).toBe((tragedy.data.defense ?? 0) + 1200);
    passBattleUntilComplete(restoredTrigger);

    restoredTrigger.session.state.phase = "main1";
    restoredTrigger.session.state.turnPlayer = 0;
    restoredTrigger.session.state.waitingFor = 0;
    const restoredMain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredMain);
    expectRestoredLegalActions(restoredMain, 0);
    const control = getLuaRestoreLegalActions(restoredMain, 0).find(
      (action) => action.type === "activateEffect" && action.uid === tragedy.uid && action.effectId === "lua-4",
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredMain, control!);
    expect(restoredMain.session.state.chain).toEqual([
      expect.objectContaining({
        effectId: "lua-4",
        player: 0,
        sourceUid: tragedy.uid,
        targetUids: [attacker.uid],
        operationInfos: [{ category: 0x2000, targetUids: [attacker.uid], count: 1, player: 0, parameter: 0 }],
      }),
    ]);
    expect(restoredMain.session.state.cards.find((card) => card.uid === controlCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: tragedy.uid,
      reasonEffectId: 4,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredMain.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("tragoedia responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: tragedy.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === controlTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    const controlledTragedy = restoredChain.session.state.cards.find((card) => card.uid === tragedy.uid)!;
    expect(currentAttack(controlledTragedy, restoredChain.session.state)).toBe((tragedy.data.attack ?? 0) + 600);
    expect(currentDefense(controlledTragedy, restoredChain.session.state)).toBe((tragedy.data.defense ?? 0) + 600);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("tragoedia responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
