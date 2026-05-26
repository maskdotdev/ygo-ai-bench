import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLeftScale, currentRightScale } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const wildHopeCode = "51391183";
const scaleTargetCode = "513911830";
const actorAllyCode = "513911831";
const secondActorAllyCode = "513911832";
const searchTargetCode = "513911833";
const offSetDecoyCode = "513911834";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasWildHopeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wildHopeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setAbyssActor = 0x10ec;
const effectUpdateAttack = 100;
const effectCannotSpecialSummon = 22;
const effectChangeLeftScale = 135;
const effectChangeRightScale = 137;
const resetsStandardPhaseEnd = 0x41fe1200;
const resetPhaseEnd = 0x40000200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasWildHopeScript)("Lua real script Abyss Actor Wild Hope scale attack destroyed search stat", () => {
  it("restores Pendulum scale change lock, monster ATK gain, and destroyed Abyss Actor search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wildHopeCode}.lua`);
    expect(script).toContain("Abyss Actor - Wild Hope");
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.SetTargetCard(tc)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LSCALE)");
    expect(script).toContain("e2:SetCode(EFFECT_CHANGE_RSCALE)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("return not c:IsSetCard(SET_ABYSS_ACTOR)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("local atkval=g:GetClassCount(Card.GetCode)*100");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("return (r&REASON_EFFECT+REASON_BATTLE)~=0");
    expect(script).toContain("return c:IsSetCard(SET_ABYSS_ACTOR) and c:IsAbleToHand() and not c:IsCode(id)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const wildHopeData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === wildHopeCode);
    expect(wildHopeData).toBeDefined();
    const reader = createCardReader([
      wildHopeData!,
      ...fixtureCards(),
    ]);

    const restoredScale = createRestoredScaleWindow({ reader, workspace });
    expectCleanRestore(restoredScale);
    expectRestoredLegalActions(restoredScale, 0);
    const scaleWildHope = requireCard(restoredScale.session, wildHopeCode);
    const scaleTarget = requireCard(restoredScale.session, scaleTargetCode);
    const scaleAction = getLuaRestoreLegalActions(restoredScale, 0).find(
      (action) => action.type === "activateEffect" && action.uid === scaleWildHope.uid && action.effectId === "lua-3",
    );
    expect(scaleAction, JSON.stringify(getLuaRestoreLegalActions(restoredScale, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredScale, scaleAction!);
    expect(restoredScale.session.state.chain).toEqual([]);
    expect(currentLeftScale(restoredScale.session.state.cards.find((card) => card.uid === scaleTarget.uid), restoredScale.session.state)).toBe(9);
    expect(currentRightScale(restoredScale.session.state.cards.find((card) => card.uid === scaleTarget.uid), restoredScale.session.state)).toBe(9);
    expect(restoredScale.session.state.effects.filter((effect) => effect.sourceUid === scaleTarget.uid && [effectChangeLeftScale, effectChangeRightScale].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLeftScale, reset: { flags: resetsStandardPhaseEnd }, value: 9 },
      { code: effectChangeRightScale, reset: { flags: resetsStandardPhaseEnd }, value: 9 },
    ]);
    expect(restoredScale.session.state.effects.filter((effect) => effect.sourceUid === scaleWildHope.uid && effect.code === effectCannotSpecialSummon).map((effect) => ({
      code: effect.code,
      description: effect.description,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([
      {
        code: effectCannotSpecialSummon,
        description: 822258931,
        luaTargetDescriptor: `target:not-setcode:${setAbyssActor}`,
        property: 67110912,
        reset: { flags: resetPhaseEnd },
        targetRange: [1, 0],
      },
    ]);
    const scaleProbe = restoredScale.host.loadScript(
      `
      local abyss_actor=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${actorAllyCode}),0,LOCATION_HAND,0,nil)
      local off_set=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${offSetDecoyCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("wild hope special lock " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,abyss_actor)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,off_set)))
      `,
      "abyss-actor-wild-hope-special-lock-probe.lua",
    );
    expect(scaleProbe.ok, scaleProbe.error).toBe(true);
    expect(restoredScale.host.messages).toContain("wild hope special lock true/false");
    expect(restoredScale.session.state.eventHistory.filter((event) => ["becameTarget", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 1 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventCardUid: scaleTarget.uid,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);

    const restoredAttack = createRestoredAttackWindow({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackWildHope = requireCard(restoredAttack.session, wildHopeCode);
    const attackAction = getLuaRestoreLegalActions(restoredAttack, 0).find(
      (action) => action.type === "activateEffect" && action.uid === attackWildHope.uid && action.effectId === "lua-4",
    );
    expect(attackAction, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attackAction!);
    expect(restoredAttack.session.state.chain).toEqual([]);
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === attackWildHope.uid), restoredAttack.session.state)).toBe(1900);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === attackWildHope.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetsStandardPhaseEnd }, value: 300 },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "chainSolved")).toEqual([
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredDestroyed = createRestoredDestroyedWindow({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedWildHope = requireCardWhere(restoredDestroyed.session, wildHopeCode, (card) => card.previousLocation === "monsterZone");
    const searchTarget = requireCard(restoredDestroyed.session, searchTargetCode);
    const offSetDecoy = requireCard(restoredDestroyed.session, offSetDecoyCode);
    expect(restoredDestroyed.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        sourceUid: destroyedWildHope.uid,
        effectId: "lua-5-1029",
        eventName: "destroyed",
        triggerBucket: "turnOptional",
        eventTriggerTiming: "if",
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventCode: 1029,
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCardUid: destroyedWildHope.uid,
      },
    ]);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === destroyedWildHope.uid && action.effectId === "lua-5-1029",
    );
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyedTrigger!);
    expect(restoredDestroyed.session.state.chain).toEqual([]);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: destroyedWildHope.uid,
      reasonEffectId: 5,
    });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredDestroyed.session.state.cards.filter((card) => card.code === wildHopeCode && card.location === "deck")).toHaveLength(1);
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      destroyedEvent(destroyedWildHope.uid),
      sentToHandEvent(searchTarget.uid, destroyedWildHope.uid),
      confirmedEvent(searchTarget.uid, destroyedWildHope.uid),
      sentToHandConfirmedEvent(searchTarget.uid, destroyedWildHope.uid),
    ]);
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: scaleTargetCode, name: "Wild Hope Abyss Actor Scale Target", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceFiend, attribute: attributeDark, level: 4, leftScale: 1, rightScale: 1, attack: 1000, defense: 1000, setcodes: [setAbyssActor] },
    { code: actorAllyCode, name: "Wild Hope Abyss Actor Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000, setcodes: [setAbyssActor] },
    { code: secondActorAllyCode, name: "Wild Hope Second Abyss Actor Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000, setcodes: [setAbyssActor] },
    { code: searchTargetCode, name: "Wild Hope Abyss Actor Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000, setcodes: [setAbyssActor] },
    { code: offSetDecoyCode, name: "Wild Hope Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredScaleWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 51391183, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [wildHopeCode, scaleTargetCode, actorAllyCode, offSetDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  movePzone(session, requireCard(session, wildHopeCode), 0);
  movePzone(session, requireCard(session, scaleTargetCode), 1);
  moveDuelCard(session.state, requireCard(session, actorAllyCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, offSetDecoyCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(wildHopeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 51391184, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [wildHopeCode, actorAllyCode, secondActorAllyCode, offSetDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, wildHopeCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, actorAllyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, secondActorAllyCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, offSetDecoyCode), 0, 3);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(wildHopeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyedWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 51391185, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [wildHopeCode, searchTargetCode, offSetDecoyCode, wildHopeCode] }, 1: { main: [] } });
  startDuel(session);
  const wildHope = requireCard(session, wildHopeCode);
  moveFaceUpAttack(session, wildHope, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(wildHopeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  destroyDuelCard(session.state, wildHope.uid, 0, duelReason.effect | duelReason.destroy, 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function movePzone(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
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

function requireCardWhere(session: DuelSession, code: string, predicate: (card: DuelCardInstance) => boolean): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && predicate(candidate));
  expect(card).toBeDefined();
  return card!;
}

function destroyedEvent(sourceUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
    eventCardUid: sourceUid,
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 5,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 5,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 5,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
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
