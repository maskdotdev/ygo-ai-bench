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
const exodiaCode = "83257450";
const exoddSpellCode = "832574500";
const opponentSpellCode = "832574501";
const defenderCode = "832574502";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasExodiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${exodiaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x08;
const setExodd = 0x1a7;

describe.skipIf(!hasUpstreamScripts || !hasExodiaScript)("Lua real script Unstoppable Exodia LP stat negate set", () => {
  it("restores LP ATK gain, Spell/Trap negate, indestructibility, End Phase Set, and Standby LP loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${exodiaCode}.lua`));
    const reader = createCardReader(cards());
    const source = opponentSpellSource(workspace);

    const battle = createExodiaRestoredField(reader, source, workspace, { loadOpponentSpell: false });
    expectCleanRestore(battle);
    expectRestoredLegalActions(battle, 0);
    const exodia = requireCard(battle.session, exodiaCode);
    const defender = requireCard(battle.session, defenderCode);
    expect(currentAttack(exodia, battle.session.state)).toBe(0);
    const attack = getLuaRestoreLegalActions(battle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === exodia.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(battle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(battle, attack!);
    passBattleUntilTrigger(battle);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(battle.session), source, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const boost = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === exodia.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, boost!);
    resolveRestoredChain(restoredPreDamage);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === exodia.uid), restoredPreDamage.session.state)).toBe(8000);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === exodia.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33492992 }, sourceUid: exodia.uid, value: 8000 },
    ]);
    finishBattle(restoredPreDamage);
    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 5000 });

    const response = createExodiaRestoredField(reader, source, workspace, { loadOpponentSpell: true });
    expectCleanRestore(response);
    const responseExodia = requireCard(response.session, exodiaCode);
    const opponentSpell = requireCard(response.session, opponentSpellCode);
    moveDuelCard(response.session.state, opponentSpell.uid, "hand", 1);
    response.session.state.phase = "main1";
    response.session.state.turnPlayer = 1;
    response.session.state.waitingFor = 1;
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(response.session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const spell = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spell, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, spell!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === responseExodia.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).not.toContain("unstoppable exodia opponent spell resolved");
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 8,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 8,
      },
    ]);
    const opponentDestroy = destroyDuelCard(restoredResponse.session.state, responseExodia.uid, 1, duelReason.effect | duelReason.destroy, 1);
    expect(opponentDestroy).toMatchObject({ uid: responseExodia.uid, location: "monsterZone", controller: 0 });
    const ownerDestroy = destroyDuelCard(restoredResponse.session.state, responseExodia.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(ownerDestroy).toMatchObject({ uid: responseExodia.uid, location: "graveyard", controller: 0 });

    const endSet = createExodiaRestoredField(reader, source, workspace, { loadOpponentSpell: false });
    expectCleanRestore(endSet);
    const endExodia = requireCard(endSet.session, exodiaCode);
    const exoddSpell = requireCard(endSet.session, exoddSpellCode);
    endSet.session.state.phase = "main2";
    endSet.session.state.turnPlayer = 0;
    endSet.session.state.waitingFor = 0;
    const restoredMain2 = restoreDuelWithLuaScripts(serializeDuel(endSet.session), source, reader);
    expectCleanRestore(restoredMain2);
    expectRestoredLegalActions(restoredMain2, 0);
    const endPhase = getLuaRestoreLegalActions(restoredMain2, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredMain2, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain2, endPhase!);
    expectRestoredLegalActions(restoredMain2, 0);
    const setTrigger = getLuaRestoreLegalActions(restoredMain2, 0).find((action) => action.type === "activateTrigger" && action.uid === endExodia.uid);
    expect(setTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredMain2, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain2, setTrigger!);
    resolveRestoredChain(restoredMain2);
    expect(restoredMain2.session.state.cards.find((card) => card.uid === exoddSpell.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredMain2.session.state.eventHistory.filter((event) => event.eventName === "spellTrapSet" && event.eventCardUid === exoddSpell.uid)).toEqual([
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: exoddSpell.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);

    const standbyLoss = createExodiaRestoredField(reader, source, workspace, { loadOpponentSpell: false });
    expectCleanRestore(standbyLoss);
    const standbyExodia = requireCard(standbyLoss.session, exodiaCode);
    standbyLoss.session.state.turn = 2;
    standbyLoss.session.state.phase = "draw";
    standbyLoss.session.state.turnPlayer = 0;
    standbyLoss.session.state.waitingFor = 0;
    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(standbyLoss.session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-7-4098",
        sourceUid: standbyExodia.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
      },
    ]);
    const restoredStandby = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), source, reader);
    expectCleanRestore(restoredStandby);
    expectRestoredLegalActions(restoredStandby, 0);
    const lossTrigger = getLuaRestoreLegalActions(restoredStandby, 0).find((action) => action.type === "activateTrigger" && action.uid === standbyExodia.uid);
    expect(lossTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredStandby, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStandby, lossTrigger!);
    resolveRestoredChain(restoredStandby);
    expect(restoredStandby.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredStandby.session.state.cards.find((card) => card.uid === standbyExodia.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_FORBIDDEN_ONE),5)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e1:SetValue(aux.indoval)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,Duel.GetLP(tp))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(Duel.GetLP(tp))");
  expect(script).toContain("re:IsSpellTrapEffect() and not e:GetHandler():IsStatus(STATUS_BATTLE_DESTROYED) and Duel.IsChainNegatable(ev)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("aux.DoubleSnareValidity(c,LOCATION_MZONE)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,g)");
  expect(script).toContain("e5:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e5:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.SetLP(tp,Duel.GetLP(tp)-1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: exodiaCode, name: "The Unstoppable Exodia Incarnate", kind: "extra", typeFlags: typeMonster | typeFusion | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 10, attack: 0, defense: 0 },
    { code: exoddSpellCode, name: "Unstoppable Exodd Set Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setExodd] },
    { code: opponentSpellCode, name: "Unstoppable Exodia Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: defenderCode, name: "Unstoppable Exodia Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 2000 },
  ];
}

function opponentSpellSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
      return workspace.readScript(name);
    },
  };
}

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("unstoppable exodia opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function createExodiaRestoredField(
  reader: ReturnType<typeof createCardReader>,
  source: { readScript(name: string): string | undefined },
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  options: { loadOpponentSpell: boolean },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 83257450, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [exoddSpellCode], extra: [exodiaCode] }, 1: { main: [opponentSpellCode, defenderCode] } });
  startDuel(session);
  const exodia = requireCard(session, exodiaCode);
  const defender = requireCard(session, defenderCode);
  moveFaceUpAttack(session, exodia, 0);
  moveFaceUpAttack(session, defender, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(exodiaCode), source).ok).toBe(true);
  if (options.loadOpponentSpell) expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(options.loadOpponentSpell ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
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

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    passBattle(restored);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      resolveRestoredChain(restored);
      continue;
    }
    passBattle(restored);
  }
}

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
