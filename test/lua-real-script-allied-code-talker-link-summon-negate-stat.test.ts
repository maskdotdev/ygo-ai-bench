import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, linkSummonDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const alliedCode = "39138610";
const linkMaterialCode = "391386100";
const materialACode = "391386101";
const materialBCode = "391386102";
const reviveCyberseCode = "391386103";
const linkedCostCode = "391386104";
const opponentSpellCode = "391386105";
const defenderCode = "391386106";
const drawFillerCode = "391386107";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAlliedScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alliedCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectCannotSpecialSummon = 22;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasAlliedScript)("Lua real script Allied Code Talker link summon negate stat", () => {
  it("restores Link Summon revive ATK gain and linked-Link release negation banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${alliedCode}.lua`));
    const reader = createCardReader(cards());

    const restoredTrigger = createRestoredLinkSummonTrigger({ reader, workspace });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const allied = requireCard(restoredTrigger.session, alliedCode);
    const reviveCyberse = requireCard(restoredTrigger.session, reviveCyberseCode);
    const defender = requireCard(restoredTrigger.session, defenderCode);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-9-1",
        player: 0,
        sourceUid: allied.uid,
        effectId: "lua-2-1102",
        eventName: "specialSummoned",
        eventPlayer: 0,
        triggerBucket: "turnOptional",
        eventCode: eventSpecialSummonSuccess,
        eventTriggerTiming: "if",
        eventCardUid: allied.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === allied.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === reviveCyberse.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: allied.uid,
      reasonEffectId: 2,
      sequence: 1,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === allied.uid), restoredTrigger.session.state)).toBe(2800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === allied.uid && effect.code === effectCannotSpecialSummon).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotSpecialSummon, description: 626217762, event: "continuous", property: 0x4000800, reset: { flags: 1073742336 }, sourceUid: allied.uid, targetRange: [1, 0], value: undefined },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventCardUid: allied.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventCardUid: reviveCyberse.uid,
        eventUids: [reviveCyberse.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: allied.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    restoredStat.session.state.phase = "battle";
    restoredStat.session.state.turnPlayer = 0;
    restoredStat.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "declareAttack" && action.attackerUid === allied.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, attack!);
    passRestoredBattle(restoredStat);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });

    const restoredResponse = createRestoredNegateResponse({ reader, workspace });
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const responseAllied = requireCard(restoredResponse.session, alliedCode);
    const linkedCost = requireCard(restoredResponse.session, linkedCostCode);
    const opponentSpell = requireCard(restoredResponse.session, opponentSpellCode);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === responseAllied.uid && action.effectId === "lua-3-1027");
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    passRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("allied code opponent spell resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === linkedCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: responseAllied.uid,
      reasonEffectId: 3,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: responseAllied.uid,
      reasonEffectId: 3,
    });
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["released", "banished", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: linkedCost.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: responseAllied.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: opponentSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: responseAllied.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 4,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 4,
      },
    ]);
  });
});

function createRestoredLinkSummonTrigger({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 39138610, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [linkMaterialCode, materialACode, materialBCode, reviveCyberseCode], extra: [alliedCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const allied = requireCard(session, alliedCode);
  const linkMaterial = requireCard(session, linkMaterialCode);
  const materialA = requireCard(session, materialACode);
  const materialB = requireCard(session, materialBCode);
  moveFaceUpAttack(session, linkMaterial, 0, 0);
  moveFaceUpAttack(session, materialA, 0, 1);
  moveFaceUpAttack(session, materialB, 0, 2);
  moveDuelCard(session.state, requireCard(session, reviveCyberseCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(alliedCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  linkSummonDuelCard(session.state, 0, allied.uid, [linkMaterial.uid, materialA.uid, materialB.uid]);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredNegateResponse({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 39138611, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [alliedCode, linkedCostCode] }, 1: { main: [opponentSpellCode, drawFillerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, alliedCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, linkedCostCode), 0, 1);
  const opponentSpell = moveDuelCard(session.state, requireCard(session, opponentSpellCode).uid, "spellTrapZone", 1);
  opponentSpell.faceUp = false;
  opponentSpell.position = "faceDown";
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const source = opponentSpellSource(workspace);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(alliedCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 1);
  const spell = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === requireCard(restoredOpen.session, opponentSpellCode).uid);
  expect(spell, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, spell!);
  return restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("return c:IsRace(RACE_CYBERSE) and c:IsAttack(2300)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_GRAVE,0,ft,ft,nil,e,tp,zone)");
  expect(script).toContain("local ct=Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP,zone)");
  expect(script).toContain("c:UpdateAttack(ct*500)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_NEGATE+CATEGORY_REMOVE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.negcostfilter,1,false,nil,nil,lg)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.negcostfilter,1,1,false,nil,nil,lg)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.IsChainNegatable(ev)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Remove(eg,POS_FACEUP,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: alliedCode, name: "Allied Code Talker @Ignister", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 5, attack: 2300, defense: 0, linkMarkers: 0x20, linkMaterialMin: 3, linkMaterialType: typeEffect },
    { code: linkMaterialCode, name: "Allied Code Link-3 Material", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 3, attack: 1800, defense: 0, linkMarkers: 0x20 },
    { code: materialACode, name: "Allied Code Effect Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Allied Code Effect Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: reviveCyberseCode, name: "Allied Code Revive Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2300, defense: 1000 },
    { code: linkedCostCode, name: "Allied Code Linked Cost Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 1, attack: 1200, defense: 0, linkMarkers: 0x8 },
    { code: opponentSpellCode, name: "Allied Code Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: defenderCode, name: "Allied Code Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: drawFillerCode, name: "Allied Code Draw Filler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("allied code opponent spell resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence?: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  if (sequence !== undefined) moved.sequence = sequence;
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
