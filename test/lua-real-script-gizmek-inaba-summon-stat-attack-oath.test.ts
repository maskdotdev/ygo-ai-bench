import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const inabaCode = "50901852";
const hasInabaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${inabaCode}.lua`));
const handMachineCode = "509018520";
const statTargetCode = "509018521";
const otherMachineCode = "509018522";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasInabaScript)("Lua real script Gizmek Inaba summon stat attack oath", () => {
  it("restores summon-success hand Machine summon and grave self-banish stat set plus selected-only attack oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${inabaCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("return c:IsDefense(c:GetAttack()) and c:IsRace(RACE_MACHINE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,0,LOCATION_HAND)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.hfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.SelectTarget(tp,s.ffilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e:SetLabel(g:GetFirst():GetFieldID())");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    expect(script).toContain("Duel.GetMatchingGroup(s.ffilter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("return e:GetLabel()~=c:GetFieldID()");

    const cards: DuelCardData[] = [
      { code: inabaCode, name: "Gizmek Inaba, the Hopping Hare of Hakuto", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 1, attack: 50, defense: 50 },
      { code: handMachineCode, name: "Inaba Equal Machine Hand Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1200, defense: 1200 },
      { code: statTargetCode, name: "Inaba Equal Machine Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1000, defense: 1000 },
      { code: otherMachineCode, name: "Inaba Other Equal Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);

    const summonSession = createDuel({ seed: 50901852, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [inabaCode, handMachineCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonInaba = requireCard(summonSession, inabaCode);
    const handMachine = requireCard(summonSession, handMachineCode);
    moveDuelCard(summonSession.state, summonInaba.uid, "hand", 0);
    moveDuelCard(summonSession.state, handMachine.uid, "hand", 0);
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;
    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(inabaCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === summonInaba.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummon, normalSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonInaba.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === handMachine.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonInaba.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === handMachine.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handMachine.uid,
        eventUids: [handMachine.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonInaba.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);

    const statSession = createDuel({ seed: 50901853, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [inabaCode, statTargetCode, otherMachineCode] }, 1: { main: [] } });
    startDuel(statSession);
    const statInaba = requireCard(statSession, inabaCode);
    const statTarget = requireCard(statSession, statTargetCode);
    const otherMachine = requireCard(statSession, otherMachineCode);
    moveDuelCard(statSession.state, statInaba.uid, "graveyard", 0);
    const target = moveDuelCard(statSession.state, statTarget.uid, "monsterZone", 0);
    target.faceUp = true;
    target.position = "faceUpAttack";
    const other = moveDuelCard(statSession.state, otherMachine.uid, "monsterZone", 0);
    other.sequence = 1;
    other.faceUp = true;
    other.position = "faceUpAttack";
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(inabaCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statInaba.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStat, statAction!);
    expect(restoredStat.session.state.chain).toEqual([]);
    expect(restoredStat.session.state.cards.find((card) => card.uid === statInaba.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statInaba.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statTarget.uid), restoredStat.session.state)).toBe(2500);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === statTarget.uid), restoredStat.session.state)).toBe(2500);
    expect(restoredStat.session.state.effects.filter((effect) => effect.code === 86 && effect.sourceUid === statInaba.uid)).toEqual([
      expect.objectContaining({
        code: 86,
        event: "continuous",
        property: 0x4080000,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: 1073742336 },
        targetRange: [4, 0],
      }),
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: statInaba.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: statInaba.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: statTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const targetAttacks = getLuaRestoreLegalActions(restoredBattle, 0).filter((action) => action.type === "declareAttack" && action.attackerUid === statTarget.uid);
    const otherAttacks = getLuaRestoreLegalActions(restoredBattle, 0).filter((action) => action.type === "declareAttack" && action.attackerUid === otherMachine.uid);
    expect(targetAttacks.length).toBeGreaterThan(0);
    expect(otherAttacks).toEqual([]);
  });
});

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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
