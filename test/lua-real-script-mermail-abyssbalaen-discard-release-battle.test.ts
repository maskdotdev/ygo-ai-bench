import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const abyssbalaenCode = "75180828";
const mermailCostA = "751808280";
const mermailCostB = "751808281";
const mermailCostC = "751808282";
const mermailCostD = "751808283";
const mermailReleaseCode = "751808284";
const opponentDestroyCode = "751808285";
const opponentDefenseCode = "751808286";
const responderCode = "751808287";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAbyssbalaenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abyssbalaenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSeaSerpent = 0x200;
const raceAqua = 0x40;
const attributeWater = 0x2;
const attributeDark = 0x20;
const setMermail = 0x74;

describe.skipIf(!hasUpstreamScripts || !hasAbyssbalaenScript)("Lua real script Mermail Abyssbalaen discard release battle", () => {
  it("restores four-card discard self Special Summon into mandatory target destroy and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${abyssbalaenCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const abyssbalaen = requireCard(session, abyssbalaenCode);
    const opponentDestroy = requireCard(session, opponentDestroyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, abyssbalaen.uid, "hand", 0);
    for (const code of [mermailCostA, mermailCostB, mermailCostC, mermailCostD]) moveDuelCard(session.state, requireCard(session, code).uid, "hand", 0);
    moveFaceUpAttack(session, opponentDestroy, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(abyssbalaenCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === abyssbalaen.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: abyssbalaen.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, targetUids: [abyssbalaen.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);
    for (const code of [mermailCostA, mermailCostB, mermailCostC, mermailCostD]) {
      expect(restoredOpen.session.state.cards.find((card) => card.code === code)).toMatchObject({
        location: "graveyard",
        reason: duelReason.cost | duelReason.discard,
        reasonPlayer: 0,
        reasonCardUid: abyssbalaen.uid,
        reasonEffectId: 1,
      });
    }

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("abyssbalaen responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === abyssbalaen.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      summonTypeCode: 0x40000001,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: abyssbalaen.uid,
      reasonEffectId: 1,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === abyssbalaen.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-9",
        chainIndex: 1,
        effectId: "lua-2-1102",
        sourceUid: abyssbalaen.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: abyssbalaen.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: abyssbalaen.uid,
        eventReasonEffectId: 1,
        eventUids: [abyssbalaen.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        targetUids: [opponentDestroy.uid],
        operationInfos: [{ category: 0x1, targetUids: [opponentDestroy.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);
    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredDestroyChain);
    resolveRestoredChain(restoredDestroyChain);
    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === opponentDestroy.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: abyssbalaen.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredDestroyChain.session.state.cards.find((card) => card.uid === abyssbalaen.uid), restoredDestroyChain.session.state)).toBe(3000);
    expect(restoredDestroyChain.session.state.eventHistory.filter((event) => ["discarded", "specialSummoned", "becameTarget", "destroyed"].includes(event.eventName))).toEqual([
      discardedEvent(requireCard(restoredDestroyChain.session, mermailCostA).uid, abyssbalaen.uid, 1, 0),
      discardedEvent(requireCard(restoredDestroyChain.session, mermailCostB).uid, abyssbalaen.uid, 2, 1),
      discardedEvent(requireCard(restoredDestroyChain.session, mermailCostC).uid, abyssbalaen.uid, 3, 2),
      discardedEvent(requireCard(restoredDestroyChain.session, mermailCostD).uid, abyssbalaen.uid, 4, 3),
      { ...discardedEvent(requireCard(restoredDestroyChain.session, mermailCostA).uid, abyssbalaen.uid, 1, 0), eventUids: [requireCard(restoredDestroyChain.session, mermailCostA).uid, requireCard(restoredDestroyChain.session, mermailCostB).uid, requireCard(restoredDestroyChain.session, mermailCostC).uid, requireCard(restoredDestroyChain.session, mermailCostD).uid] },
      specialSummonedEvent(abyssbalaen.uid),
      becameTargetEvent(opponentDestroy.uid, abyssbalaen.uid),
      destroyedEvent(opponentDestroy.uid, abyssbalaen.uid),
    ]);
  });

  it("restores release-cost Main Phase ignition into temporary battle-start defense destroy trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${abyssbalaenCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const abyssbalaen = requireCard(session, abyssbalaenCode);
    const releaseCost = requireCard(session, mermailReleaseCode);
    const defenseTarget = requireCard(session, opponentDefenseCode);
    moveFaceUpAttack(session, abyssbalaen, 0);
    moveFaceUpAttack(session, releaseCost, 0);
    moveFaceUpDefense(session, defenseTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(abyssbalaenCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const battleSetup = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === abyssbalaen.uid);
    expect(battleSetup, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, battleSetup!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: abyssbalaen.uid,
      reasonEffectId: 3,
    });
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.flagEffects).toContainEqual(expect.objectContaining({ ownerId: abyssbalaen.uid, code: Number(abyssbalaenCode), value: 0 }));

    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.waitingFor = 0;
    const attack = getLegalActions(restoredChain.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === abyssbalaen.uid && action.targetUid === defenseTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(restoredChain.session, 0), null, 2)).toBeDefined();
    applyAndAssert(restoredChain.session, attack!);
    passUntilPendingTrigger(restoredChain.session, "battleStarted");

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-4-1132",
        sourceUid: abyssbalaen.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "battleStarted",
        eventCode: 1132,
        eventPlayer: 0,
        eventCardUid: abyssbalaen.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        eventUids: [abyssbalaen.uid, defenseTarget.uid],
      },
    ]);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === abyssbalaen.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battleTrigger!);
    const restoredBattleChain = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredBattleChain);
    resolveRestoredChain(restoredBattleChain);
    expect(restoredBattleChain.session.state.cards.find((card) => card.uid === defenseTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: abyssbalaen.uid,
      reasonEffectId: 4,
    });
    expect(restoredBattleChain.session.state.eventHistory.filter((event) => ["released", "battleStarted", "destroyed"].includes(event.eventName))).toEqual([
      releasedEvent(releaseCost.uid, abyssbalaen.uid),
      {
        eventName: "battleStarted",
        eventCode: 1132,
        eventCardUid: abyssbalaen.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [abyssbalaen.uid, defenseTarget.uid],
      },
      destroyedEvent(defenseTarget.uid, abyssbalaen.uid, 4, { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 }),
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,4,4,REASON_COST|REASON_DISCARD,e:GetHandler())");
  expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
  expect(script).toContain("local ct=Duel.GetMatchingGroupCount(s.descount,tp,LOCATION_GRAVE,0,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_ONFIELD,1,ct,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("return Duel.IsPhase(PHASE_MAIN1)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.rfilter,1,false,nil,e:GetHandler())");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.rfilter,1,1,false,nil,e:GetHandler())");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("Duel.GetAttacker()==e:GetHandler() and d~=nil and d:IsDefensePos()");
  expect(script).toContain("Duel.Destroy(d,REASON_EFFECT)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === abyssbalaenCode),
    mermailCard(mermailCostA, "Abyssbalaen Cost Mermail A", 1200, 1000),
    mermailCard(mermailCostB, "Abyssbalaen Cost Mermail B", 1300, 1000),
    mermailCard(mermailCostC, "Abyssbalaen Cost Mermail C", 1400, 1000),
    mermailCard(mermailCostD, "Abyssbalaen Cost Mermail D", 1500, 1000),
    mermailCard(mermailReleaseCode, "Abyssbalaen Release Mermail", 1600, 1000),
    { code: opponentDestroyCode, name: "Abyssbalaen Opponent Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentDefenseCode, name: "Abyssbalaen Opponent Defense Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeDark, level: 4, attack: 1000, defense: 2000 },
    { code: responderCode, name: "Abyssbalaen Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 75180828, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [abyssbalaenCode, mermailCostA, mermailCostB, mermailCostC, mermailCostD, mermailReleaseCode] },
    1: { main: [opponentDestroyCode, opponentDefenseCode, responderCode] },
  });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      const loaded = workspace.readScript(name);
      if (loaded === undefined) throw new Error(`Missing script ${name}`);
      return loaded;
    },
  };
  return { session, reader, source };
}

function mermailCard(code: string, name: string, attack: number, defense: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack, defense, setcodes: [setMermail] };
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
      e:SetOperation(function(e,tp) Debug.Message("abyssbalaen responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (session.state.pendingBattle && !session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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

function discardedEvent(cardUid: string, sourceUid: string, previousSequence: number, currentSequence: number) {
  return {
    eventName: "discarded",
    eventCode: 1018,
    eventCardUid: cardUid,
    eventReason: duelReason.cost | duelReason.discard,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: currentSequence },
  };
}

function specialSummonedEvent(cardUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 1,
    eventUids: [cardUid],
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
}

function becameTargetEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    eventChainDepth: 1,
    eventChainLinkId: "chain-9",
    relatedEffectId: 2,
    eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
    eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
}

function releasedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: cardUid,
    eventReason: duelReason.cost | duelReason.release,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, effectId = 2, previous = { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: previous,
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: previous.position, sequence: 0 },
  };
}
