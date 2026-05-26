import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const codeHackCode = "33750856";
const codeTalkerCode = "337508560";
const defenderCode = "337508561";
const decoyCode = "337508562";
const responderCode = "337508563";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCodeHackScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${codeHackCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setCodeTalker = 0x101;

describe.skipIf(!hasUpstreamScripts || !hasCodeHackScript)("Lua real script Code Hack battle-step negate stat", () => {
  it("restores field indestructibility, Battle Step ATK zero, no battle damage, and grave Damage Step negate boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${codeHackCode}.lua`));
    const reader = createCardReader(cards());
    const source = damageStepResponderSource(workspace);

    const restoredOpen = createRestoredField({ reader, source, workspace, codeHackLocation: "spellTrapZone" });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const codeHack = requireCard(restoredOpen.session, codeHackCode);
    const codeTalker = requireCard(restoredOpen.session, codeTalkerCode);
    const decoy = requireCard(restoredOpen.session, decoyCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === codeHack.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 1002, event: "quick", id: "lua-1-1002", property: undefined, range: ["spellTrapZone"], reset: undefined, sourceUid: codeHack.uid, targetRange: undefined, value: undefined },
      { category: undefined, code: 41, event: "continuous", id: "lua-2-41", property: undefined, range: ["spellTrapZone"], reset: undefined, sourceUid: codeHack.uid, targetRange: [4, 0], value: undefined },
      { category: 0x200000, code: 1002, event: "quick", id: "lua-3-1002", property: undefined, range: ["spellTrapZone"], reset: undefined, sourceUid: codeHack.uid, targetRange: undefined, value: undefined },
      { category: 0x10200000, code: 1027, event: "quick", id: "lua-4-1027", property: 0xc000, range: ["graveyard"], reset: undefined, sourceUid: codeHack.uid, targetRange: undefined, value: undefined },
    ]);
    const protectedDestroy = destroyDuelCard(restoredOpen.session.state, codeTalker.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(protectedDestroy).toMatchObject({ uid: codeTalker.uid, location: "monsterZone", controller: 0 });
    const vulnerableDestroy = destroyDuelCard(restoredOpen.session.state, decoy.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(vulnerableDestroy).toMatchObject({ uid: decoy.uid, location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 1 });

    const restoredBattle = createRestoredField({ reader, source, workspace, codeHackLocation: "spellTrapZone" });
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const battleCodeHack = requireCard(restoredBattle.session, codeHackCode);
    const battleCodeTalker = requireCard(restoredBattle.session, codeTalkerCode);
    const battleDefender = requireCard(restoredBattle.session, defenderCode);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === battleCodeTalker.uid && action.targetUid === battleDefender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattleAction(restoredBattle, 1, "passAttack");
    expectRestoredLegalActions(restoredBattle, 0);
    const battleStepHack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateEffect" && action.uid === battleCodeHack.uid && action.effectId === "lua-3-1002");
    expect(battleStepHack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battleStepHack!);
    expect(restoredBattle.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredBattle);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === battleDefender.uid), restoredBattle.session.state)).toBe(0);
    expect(restoredBattle.session.state.effects.filter((effect) => [42, 111, 201].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 42, property: undefined, reset: { flags: 1107169312 }, sourceUid: battleDefender.uid, targetRange: undefined, value: 1 },
      { code: 42, property: undefined, reset: { flags: 1107169312 }, sourceUid: battleCodeTalker.uid, targetRange: undefined, value: 1 },
      { code: 201, property: 0x800, reset: { flags: 1073741856 }, sourceUid: battleCodeHack.uid, targetRange: [1, 1], value: undefined },
    ]);
    finishRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === battleDefender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === battleCodeTalker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    const restoredDamage = createRestoredField({ reader, source, workspace, codeHackLocation: "graveyard" });
    expectCleanRestore(restoredDamage);
    restoredDamage.session.state.phase = "battle";
    restoredDamage.session.state.turnPlayer = 0;
    restoredDamage.session.state.waitingFor = 0;
    const graveCodeHack = requireCard(restoredDamage.session, codeHackCode);
    const damageCodeTalker = requireCard(restoredDamage.session, codeTalkerCode);
    const damageDefender = requireCard(restoredDamage.session, defenderCode);
    const responder = requireCard(restoredDamage.session, responderCode);
    expectRestoredLegalActions(restoredDamage, 0);
    const damageAttack = getLuaRestoreLegalActions(restoredDamage, 0).find((action) => action.type === "declareAttack" && action.attackerUid === damageCodeTalker.uid && action.targetUid === damageDefender.uid);
    expect(damageAttack, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, damageAttack!);
    passRestoredBattleAction(restoredDamage, 1, "passAttack");
    passRestoredBattleAction(restoredDamage, 0, "passAttack");
    passRestoredBattleAction(restoredDamage, 1, "passDamage");
    expect(restoredDamage.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });
    passRestoredBattleAction(restoredDamage, 0, "passDamage");
    expect(restoredDamage.session.state.battleWindow).toMatchObject({ kind: "beforeDamageCalculation", step: "damage", responsePlayer: 1 });
    expectRestoredLegalActions(restoredDamage, 1);
    const responderAction = getLuaRestoreLegalActions(restoredDamage, 1).find((action) => action.type === "activateEffect" && action.uid === responder.uid);
    expect(responderAction, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, responderAction!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredDamage.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === graveCodeHack.uid && action.effectId === "lua-4-1027");
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).not.toContain("code hack damage step responder resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === graveCodeHack.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCodeHack.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === damageCodeTalker.uid), restoredResponse.session.state)).toBe(3000);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["banished", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveCodeHack.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveCodeHack.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        relatedEffectId: 5,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        relatedEffectId: 5,
      },
    ]);
    finishRestoredBattle(restoredResponse);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("return c:IsRace(RACE_CYBERSE) and c:IsLinkMonster()");
  expect(script).toContain("e2:SetHintTiming(TIMING_BATTLE_PHASE)");
  expect(script).toContain("Duel.IsPhase(PHASE_BATTLE_STEP)");
  expect(script).toContain("local sc,oc=Duel.GetBattleMonster(tp)");
  expect(script).toContain("Duel.SetTargetCard(Group.FromCards(oc,sc))");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetCurrentPhase()&(PHASE_DAMAGE|PHASE_DAMAGE_CAL)==0 or Duel.IsDamageCalculated()");
  expect(script).toContain("a:IsControler(tp) and a:IsSetCard(SET_CODE_TALKER) and ep==1-tp and Duel.IsChainNegatable(ev)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,0,0)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("tc:IsFaceup() and tc:IsRelateToBattle()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(700)");
}

function cards(): DuelCardData[] {
  return [
    { code: codeHackCode, name: "Code Hack", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: codeTalkerCode, name: "Code Hack Code Talker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 3, attack: 2300, defense: 0, setcodes: [setCodeTalker], linkMarkers: 0x20 },
    { code: defenderCode, name: "Code Hack Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2700, defense: 2000 },
    { code: decoyCode, name: "Code Hack Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: responderCode, name: "Code Hack Damage Step Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function damageStepResponderSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return damageStepResponderScript();
      return workspace.readScript(name);
    },
  };
}

function damageStepResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetDescription(aux.Stringid(id,0))
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function()
        return Duel.GetCurrentPhase()&(PHASE_DAMAGE|PHASE_DAMAGE_CAL)>0 and not Duel.IsDamageCalculated()
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("code hack damage step responder resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function createRestoredField({
  reader,
  source,
  workspace,
  codeHackLocation,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  codeHackLocation: "spellTrapZone" | "graveyard";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33750856, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [codeHackCode, decoyCode], extra: [codeTalkerCode] }, 1: { main: [defenderCode, responderCode] } });
  startDuel(session);
  const codeHack = requireCard(session, codeHackCode);
  const codeTalker = requireCard(session, codeTalkerCode);
  const defender = requireCard(session, defenderCode);
  const decoy = requireCard(session, decoyCode);
  const responder = requireCard(session, responderCode);
  if (codeHackLocation === "spellTrapZone") {
    const movedCodeHack = moveDuelCard(session.state, codeHack.uid, "spellTrapZone", 0);
    movedCodeHack.faceUp = true;
    movedCodeHack.position = "faceUpAttack";
  } else {
    const movedCodeHack = moveDuelCard(session.state, codeHack.uid, "graveyard", 0);
    movedCodeHack.faceUp = true;
  }
  moveFaceUpAttack(session, codeTalker, 0, 0);
  moveFaceUpAttack(session, decoy, 0, 1);
  moveFaceUpAttack(session, defender, 1, 0);
  moveDuelCard(session.state, responder.uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(codeHackCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
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

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: DuelAction["type"]): void {
  expectRestoredLegalActions(restored, player);
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
