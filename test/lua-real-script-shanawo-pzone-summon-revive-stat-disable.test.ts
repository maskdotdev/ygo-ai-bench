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
const shanawoCode = "90587641";
const opponentAttackerCode = "905876410";
const graveSamuraiCode = "905876411";
const stSamuraiCode = "905876412";
const responderCode = "905876413";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasShanawoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shanawoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typePendulum = 0x1000000;
const typeContinuous = 0x10000;
const setSuperheavySamurai = 0x9a;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasShanawoScript)("Lua real script Superheavy Samurai Commander Shanawo", () => {
  it("restores attack-announcement PZone self summon into opponent ATK 0/disable and Battle Phase revive with optional PZone return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${shanawoCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c,false)");
    expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,at,1,tp,-at:GetAttack())");
    expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE|LOCATION_STZONE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.CheckPendulumZones(tp)");
    expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shanawoCode),
      { code: opponentAttackerCode, name: "Shanawo Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
      superheavyMonster(graveSamuraiCode, "Shanawo Graveyard Superheavy Samurai"),
      superheavyMonster(stSamuraiCode, "Shanawo S/T Superheavy Samurai"),
      { code: responderCode, name: "Shanawo Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 90587641, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [graveSamuraiCode, stSamuraiCode], extra: [shanawoCode] }, 1: { main: [opponentAttackerCode, responderCode] } });
    startDuel(session);

    const shanawo = requireCard(session, shanawoCode);
    const opponentAttacker = requireCard(session, opponentAttackerCode);
    const graveSamurai = requireCard(session, graveSamuraiCode);
    const stSamurai = requireCard(session, stSamuraiCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, shanawo.uid, "spellTrapZone", 0).sequence = 0;
    shanawo.faceUp = true;
    moveFaceUpAttack(session, opponentAttacker, 1);
    moveDuelCard(session.state, graveSamurai.uid, "graveyard", 0);
    graveSamurai.faceUp = true;
    delete graveSamurai.reasonEffectId;
    const movedStSamurai = moveDuelCard(session.state, stSamurai.uid, "spellTrapZone", 0);
    movedStSamurai.faceUp = true;
    movedStSamurai.sequence = 2;
    delete movedStSamurai.reasonEffectId;
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
    expect(host.loadCardScript(Number(shanawoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredAttackAnnounce = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredAttackAnnounce);
    expectRestoredLegalActions(restoredAttackAnnounce, 0);
    const selfSummon = getLuaRestoreLegalActions(restoredAttackAnnounce, 0).find(
      (action): action is Extract<DuelAction, { type: "activateTrigger" }> => action.type === "activateTrigger" && action.uid === shanawo.uid,
    );
    expect(selfSummon, JSON.stringify(getLuaRestoreLegalActions(restoredAttackAnnounce, 0), null, 2)).toBeDefined();
    expect(restoredAttackAnnounce.session.state.pendingTriggers).toEqual([
      {
        id: selfSummon!.triggerId,
        effectId: selfSummon!.effectId,
        sourceUid: shanawo.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: opponentAttacker.uid,
        eventReason: 0,
        eventPlayer: 1,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    applyRestoredActionAndAssert(restoredAttackAnnounce, selfSummon!);
    passRestoredChain(restoredAttackAnnounce);

    expect(restoredAttackAnnounce.session.state.cards.find((card) => card.uid === shanawo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: shanawo.uid,
    });
    expect(typeof restoredAttackAnnounce.session.state.cards.find((card) => card.uid === shanawo.uid)?.reasonEffectId).toBe("number");
    expect(currentAttack(restoredAttackAnnounce.session.state.cards.find((card) => card.uid === opponentAttacker.uid), restoredAttackAnnounce.session.state)).toBe(0);
    expect(restoredAttackAnnounce.session.state.effects.filter((effect) => effect.sourceUid === opponentAttacker.uid && [2, 3].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, reset: { flags: 33427456 }, value: undefined },
    ]);

    const shanawoAfterSummon = restoredAttackAnnounce.session.state.cards.find((card) => card.uid === shanawo.uid);
    expect(shanawoAfterSummon).toBeDefined();
    shanawoAfterSummon!.summonType = "synchro";
    shanawoAfterSummon!.summonPlayer = 0;
    restoredAttackAnnounce.session.state.waitingFor = 0;
    restoredAttackAnnounce.session.state.turnPlayer = 0;
    const restoredQuickOpen = restoreDuelWithLuaScripts(serializeDuel(restoredAttackAnnounce.session), source, reader);
    expectCleanRestore(restoredQuickOpen);
    expectRestoredLegalActions(restoredQuickOpen, 0);
    const revive = getLuaRestoreLegalActions(restoredQuickOpen, 0).find((action) => action.type === "activateEffect" && action.uid === shanawo.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredQuickOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuickOpen, revive!);
    passRestoredChain(restoredQuickOpen);

    expect(restoredQuickOpen.session.state.cards.find((card) => card.uid === graveSamurai.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: shanawo.uid,
    });
    expect(typeof restoredQuickOpen.session.state.cards.find((card) => card.uid === graveSamurai.uid)?.reasonEffectId).toBe("number");
    expect(restoredQuickOpen.session.state.cards.find((card) => card.uid === shanawo.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: shanawo.uid,
    });
    expect(typeof restoredQuickOpen.session.state.cards.find((card) => card.uid === shanawo.uid)?.reasonEffectId).toBe("number");
    expect(restoredQuickOpen.session.state.cards.find((card) => card.uid === stSamurai.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 2,
    });
    expect(restoredQuickOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function superheavyMonster(code: string, name: string): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect | typeSynchro | typePendulum | typeContinuous,
    level: 6,
    attack: 1600,
    defense: 2000,
    leftScale: 1,
    rightScale: 1,
    setcodes: [setSuperheavySamurai],
  };
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

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("shanawo responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
