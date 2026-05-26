import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const sublimationCode = "35614780";
const hasSublimationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sublimationCode}.lua`));
const costDragonCode = "356147800";
const opponentAttackerCode = "356147801";
const responderCode = "356147802";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSublimationScript)("Lua real script Light End Sublimation Dragon special battle stat", () => {
  it("restores hand Special Summon cost lock and attack-announcement ATK/DEF reductions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${sublimationCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("return c:IsLevel(8) and c:IsRace(RACE_DRAGON) and c:IsAbleToRemoveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.hspcostfilter,tp,LOCATION_EXTRA,0,1,1,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetTarget(function(e,c) return not c:IsRace(RACE_DRAGON) end)");
    expect(script).toContain("e2:SetTarget(Fusion.SummonEffTG())");
    expect(script).toContain("e2:SetOperation(Fusion.SummonEffOP())");
    expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.GetAttacker():IsControler(1-tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,#g,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DEFCHANGE,c,1,tp,-500)");
    expect(script).toContain("c:UpdateAttack(-500)");
    expect(script).toContain("c:UpdateDefense(-500)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-1500)");

    const cards: DuelCardData[] = [
      { code: sublimationCode, name: "Light End Sublimation Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 2600, defense: 2100 },
      { code: costDragonCode, name: "Sublimation Extra Dragon Cost", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceDragon, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
      { code: opponentAttackerCode, name: "Sublimation Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 3000, defense: 1000 },
      { code: responderCode, name: "Sublimation Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 35614780, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sublimationCode], extra: [costDragonCode] }, 1: { main: [opponentAttackerCode, responderCode] } });
    startDuel(session);

    const sublimation = requireCard(session, sublimationCode);
    const costDragon = requireCard(session, costDragonCode);
    const opponentAttacker = requireCard(session, opponentAttackerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, sublimation.uid, "hand", 0);
    moveDuelCard(session.state, opponentAttacker.uid, "monsterZone", 1);
    opponentAttacker.faceUp = true;
    opponentAttacker.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sublimationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const special = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === sublimation.uid);
    expect(special, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, special!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: sublimation.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, targetUids: [sublimation.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === costDragon.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: sublimation.uid,
      reasonEffectId: 1,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("sublimation responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === sublimation.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: sublimation.uid,
      reasonEffectId: 1,
    });
    expect(
      restoredChain.session.state.effects.some((effect) => effect.sourceUid === sublimation.uid && effect.code === 22 && effect.targetRange?.[0] === 1 && effect.targetRange?.[1] === 0),
      JSON.stringify(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === sublimation.uid), null, 2),
    ).toBe(true);

    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.turnPlayer = 1;
    restoredChain.session.state.waitingFor = 1;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid && action.targetUid === sublimation.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredAttackAnnounce = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredAttackAnnounce);
    expectRestoredLegalActions(restoredAttackAnnounce, 0);
    expect(restoredAttackAnnounce.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-3-1130",
        sourceUid: sublimation.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventPlayer: 1,
        eventCardUid: opponentAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventUids: [opponentAttacker.uid, sublimation.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const battleTrigger = getLuaRestoreLegalActions(restoredAttackAnnounce, 0).find((action) => action.type === "activateTrigger" && action.uid === sublimation.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttackAnnounce, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackAnnounce, battleTrigger!);
    expect(restoredAttackAnnounce.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        effectId: "lua-3-1130",
        sourceUid: sublimation.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "attackDeclared",
        eventCode: 1130,
        eventPlayer: 1,
        eventCardUid: opponentAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventUids: [opponentAttacker.uid, sublimation.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x200000, targetUids: [sublimation.uid, opponentAttacker.uid], count: 2, player: 0, parameter: 0 },
          { category: 0x400000, targetUids: [sublimation.uid], count: 1, player: 0, parameter: -500 },
        ],
      },
    ]);

    const restoredBattleChain = restoreDuelWithLuaScripts(serializeDuel(restoredAttackAnnounce.session), source, reader);
    expectCleanRestore(restoredBattleChain);
    expectRestoredLegalActions(restoredBattleChain, 1);
    resolveRestoredChain(restoredBattleChain);
    expect(currentAttack(restoredBattleChain.session.state.cards.find((card) => card.uid === sublimation.uid), restoredBattleChain.session.state)).toBe(2100);
    expect(currentDefense(restoredBattleChain.session.state.cards.find((card) => card.uid === sublimation.uid), restoredBattleChain.session.state)).toBe(1600);
    expect(currentAttack(restoredBattleChain.session.state.cards.find((card) => card.uid === opponentAttacker.uid), restoredBattleChain.session.state)).toBe(1500);
    expect(
      restoredBattleChain.session.state.effects.some((effect) => effect.sourceUid === opponentAttacker.uid && effect.code === 100 && effect.value === -1500),
      JSON.stringify(restoredBattleChain.session.state.effects.filter((effect) => effect.code === 100), null, 2),
    ).toBe(true);
    expect(restoredBattleChain.session.state.eventHistory.filter((event) => ["banished", "specialSummoned", "attackDeclared"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: costDragon.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: sublimation.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: sublimation.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: sublimation.uid,
        eventReasonEffectId: 1,
        eventUids: [sublimation.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: opponentAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventUids: [opponentAttacker.uid, sublimation.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
      e:SetOperation(function(e,tp) Debug.Message("sublimation responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
