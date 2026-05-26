import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, linkSummonDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const echidnaCode = "8602351";
const reptileMaterialCode = "86023510";
const genericMaterialCode = "86023511";
const attackTargetCode = "86023512";
const zeroAttackTargetCode = "86023513";
const reptileSearchACode = "86023514";
const reptileSearchBCode = "86023515";
const warriorDecoyCode = "86023516";
const reptileExtraCode = "86023517";
const warriorExtraCode = "86023518";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasEchidnaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${echidnaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceWarrior = 0x1;
const raceReptile = 0x80000;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;
const effectCannotSpecialSummon = 22;
const effectClockLizardCheck = 51476410;
const effectFlagCannotDisable = 0x400;
const resetEventStandard = 0x1fe1000;
const resetPhaseEnd = 0x40000200;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasEchidnaScript)("Lua real script Reptilianne Echidna link summon zero search lock stat", () => {
  it("restores Link Summon ATK zeroing, Reptile search, and temporary Extra Deck Reptile lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${echidnaCode}.lua`);
    expect(script).toContain("Reptilianne Echidna");
    expect(script).toContain("Link.AddProcedure(c,nil,2,2,s.lcheck)");
    expect(script).toContain("return g:IsExists(Card.IsRace,1,nil,RACE_REPTILE,lc,sumtype,tp)");
    expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
    expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SEARCH+CATEGORY_TOHAND)");
    expect(script).toContain("local ct=Duel.GetMatchingGroupCount(s.ctfilter,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,ct,aux.dncheck,0)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("return c:IsLocation(LOCATION_EXTRA) and not c:IsRace(RACE_REPTILE)");
    expect(script).toContain("aux.addTempLizardCheck(e:GetHandler(),tp,s.lizfilter)");
    expect(script).toContain("return not c:IsOriginalRace(RACE_REPTILE)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,ct,aux.dncheck,1,tp,HINTMSG_ATOHAND)");
    expect(script).toContain("Duel.SendtoHand(sg,tp,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");

    const echidnaData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === echidnaCode);
    expect(echidnaData).toBeDefined();
    const reader = createCardReader([
      echidnaData!,
      ...fixtureCards(),
    ]);

    const restoredTrigger = createRestoredLinkSummonWindow({ reader, workspace });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const echidna = requireCard(restoredTrigger.session, echidnaCode);
    const attackTarget = requireCard(restoredTrigger.session, attackTargetCode, 1);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        player: 0,
        sourceUid: echidna.uid,
        effectId: "lua-2-1102",
        eventName: "specialSummoned",
        triggerBucket: "turnOptional",
        eventTriggerTiming: "if",
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link,
        eventReasonPlayer: 0,
        eventCode: eventSpecialSummonSuccess,
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: echidna.uid,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === echidna.uid && action.effectId === "lua-2-1102",
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === attackTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: effectFlagCannotDisable, reset: { flags: resetEventStandard }, value: 0 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: echidna.uid,
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-7",
        eventCardUid: attackTarget.uid,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-7",
      },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const search = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "activateEffect" && action.uid === echidna.uid && action.effectId === "lua-3",
    );
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, search!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    const searched = restoredOpen.session.state.cards.find((card) => card.reasonCardUid === echidna.uid && card.reasonEffectId === 3 && card.location === "hand");
    expect(searched).toBeDefined();
    expect(searched).toMatchObject({
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: echidna.uid,
      reasonEffectId: 3,
    });
    expect([reptileSearchACode, reptileSearchBCode]).toContain(searched!.code);
    expect(restoredOpen.session.state.cards.find((card) => card.code === warriorDecoyCode)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === echidna.uid && [effectCannotSpecialSummon, effectClockLizardCheck].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: effectCannotSpecialSummon,
        description: 137637618,
        luaTargetDescriptor: `special-summon-limit:not-race-extra:${raceReptile}`,
        property: 67110912,
        reset: { flags: resetPhaseEnd },
        targetRange: [1, 0],
        value: undefined,
      },
      {
        code: effectClockLizardCheck,
        description: undefined,
        luaTargetDescriptor: `target:not-original-race:${raceReptile}`,
        property: undefined,
        reset: { flags: resetPhaseEnd },
        targetRange: [255, 0],
        value: 1,
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToHandEvent(searched!.uid, echidna.uid, searched!.previousSequence ?? 0),
      confirmedEvent(searched!.uid, echidna.uid, searched!.previousSequence ?? 0),
      sentToHandConfirmedEvent(searched!.uid, echidna.uid, searched!.previousSequence ?? 0),
    ]);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLock);
    expectRestoredLegalActions(restoredLock, 0);
    const reptileExtra = requireCard(restoredLock.session, reptileExtraCode);
    const warriorExtra = requireCard(restoredLock.session, warriorExtraCode);
    const lockProbe = restoredLock.host.loadScript(
      `
      local reptile=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${reptileExtraCode}),0,LOCATION_EXTRA,0,nil)
      local warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorExtraCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("echidna extra current lock " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,reptile)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,warrior)))
      `,
      "reptilianne-echidna-extra-current-race-lock-probe.lua",
    );
    expect(lockProbe.ok, lockProbe.error).toBe(true);
    expect(restoredLock.host.messages).toContain("echidna extra current lock true/false");
    const lizardEffect = restoredLock.session.state.effects.find((effect) => effect.sourceUid === echidna.uid && effect.code === effectClockLizardCheck);
    expect(lizardEffect?.targetCardPredicate).toBeDefined();
    const lizardContext = targetContext(restoredLock.session.state, echidna);
    expect(lizardEffect!.targetCardPredicate!(lizardContext, reptileExtra)).toBe(false);
    expect(lizardEffect!.targetCardPredicate!(lizardContext, warriorExtra)).toBe(true);
    expect(restoredLock.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: reptileMaterialCode, name: "Echidna Reptile Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: genericMaterialCode, name: "Echidna Generic Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: attackTargetCode, name: "Echidna Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: zeroAttackTargetCode, name: "Echidna Zero Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 0, defense: 1000 },
    { code: reptileSearchACode, name: "Echidna Reptile Search A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: reptileSearchBCode, name: "Echidna Reptile Search B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1300, defense: 1000 },
    { code: warriorDecoyCode, name: "Echidna Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
    { code: reptileExtraCode, name: "Echidna Reptile Extra", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceReptile, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: warriorExtraCode, name: "Echidna Warrior Extra", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function createRestoredLinkSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 8602351, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [reptileMaterialCode, genericMaterialCode, reptileSearchACode, reptileSearchBCode, warriorDecoyCode], extra: [echidnaCode, reptileExtraCode, warriorExtraCode] },
    1: { main: [attackTargetCode, zeroAttackTargetCode] },
  });
  startDuel(session);
  const echidna = requireCard(session, echidnaCode);
  const reptileMaterial = requireCard(session, reptileMaterialCode);
  const genericMaterial = requireCard(session, genericMaterialCode);
  moveFaceUpAttack(session, reptileMaterial, 0, 0);
  moveFaceUpAttack(session, genericMaterial, 0, 1);
  moveFaceUpAttack(session, requireCard(session, attackTargetCode, 1), 1, 0);
  moveFaceUpAttack(session, requireCard(session, zeroAttackTargetCode, 1), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(echidnaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  linkSummonDuelCard(session.state, 0, echidna.uid, [reptileMaterial.uid, genericMaterial.uid]);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
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
