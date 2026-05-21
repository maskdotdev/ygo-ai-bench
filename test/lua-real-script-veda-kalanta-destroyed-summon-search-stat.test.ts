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
const vedaCode = "27015862";
const visasCode = "56099748";
const clearNewWorldCode = "21570001";
const ownDestroyedCode = "270158620";
const ownDestroyedMonsterCode = "270158621";
const opponentTargetCode = "270158622";
const destroyerCode = "270158623";
const responderCode = "270158624";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVedaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vedaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasVedaScript)("Lua real script Veda Kalanta destroyed summon search stat", () => {
  it("restores destroyed-card hand Special Summon into optional Clear New World search", () => {
    const { workspace, source } = sourceWithDestroyer();
    const script = workspace.readScript(`official/c${vedaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsReason(REASON_EFFECT)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,LOCATION_HAND)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");

    const cards = vedaCards();
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 27015862, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vedaCode, visasCode, clearNewWorldCode, ownDestroyedCode, destroyerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const veda = requireCard(session, vedaCode);
    const visas = requireCard(session, visasCode);
    const clearNewWorld = requireCard(session, clearNewWorldCode);
    const destroyed = requireCard(session, ownDestroyedCode);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode, 1);
    moveDuelCard(session.state, veda.uid, "hand", 0);
    moveFaceUpAttack(session, visas, 0);
    moveDuelCard(session.state, destroyed.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, destroyer, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [vedaCode, destroyerCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const destroy = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, destroy!);
    resolveRestoredChain(restoredOpen);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1029",
        sourceUid: veda.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: destroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === veda.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-1-1029",
        sourceUid: veda.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: destroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        operationInfos: [
          { category: 0x200, targetUids: [veda.uid], count: 1, player: 0, parameter: 0x2 },
        ],
        possibleOperationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x11 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
    ]);
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${clearNewWorldCode}`);
    expect(restoredChain.session.state.cards.find((card) => card.uid === veda.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: veda.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === clearNewWorld.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: veda.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["destroyed", "specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      specialSummonedEvent(veda.uid, veda.uid, 1, "hand", 0, 2),
      sentToHandEvent(clearNewWorld.uid, veda.uid, 1, 4),
      confirmedEvent(clearNewWorld.uid, veda.uid, 1, 4),
      sentToHandConfirmedEvent(clearNewWorld.uid, veda.uid, 1, 4),
    ]);
  });

  it("restores own destroyed monster trigger into opponent target destruction and ATK gain", () => {
    const { workspace, source } = sourceWithDestroyer();
    const script = workspace.readScript(`official/c${vedaCode}.lua`);
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(tc:GetBaseAttack())");

    const cards = vedaCards();
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 27015863, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vedaCode, ownDestroyedMonsterCode, destroyerCode] }, 1: { main: [opponentTargetCode, responderCode] } });
    startDuel(session);

    const veda = requireCard(session, vedaCode);
    const destroyed = requireCard(session, ownDestroyedMonsterCode);
    const opponentTarget = requireCard(session, opponentTargetCode, 1);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode, 1);
    moveFaceUpAttack(session, veda, 0);
    moveFaceUpAttack(session, destroyed, 0);
    moveFaceUpAttack(session, destroyer, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [vedaCode, destroyerCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const destroy = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, destroy!);
    resolveRestoredChain(restoredOpen);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === veda.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-2-1029",
        sourceUid: veda.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: destroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        targetUids: [opponentTarget.uid],
        operationInfos: [{ category: 0x1, targetUids: [opponentTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: veda.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === veda.uid), restoredChain.session.state)).toBe(3700);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === veda.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, event: "continuous", reset: { flags: 1107235328 }, value: 2200 }]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      destroyedEvent(destroyed.uid, destroyer.uid, 3, { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 }, { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 }),
      destroyedEvent(opponentTarget.uid, veda.uid, 2, { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }, { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 }),
    ]);
  });
});

function sourceWithDestroyer() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  return {
    workspace,
    source: {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    },
  };
}

function vedaCards(): DuelCardData[] {
  return [
    { code: vedaCode, name: "Veda Kalanta", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 8, attack: 1500, defense: 2100 },
    { code: visasCode, name: "Visas Starfrost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 6, attack: 2100, defense: 1500 },
    { code: clearNewWorldCode, name: "Clear New World", kind: "spell", typeFlags: typeSpell },
    { code: ownDestroyedCode, name: "Veda Destroyed Spell", kind: "spell", typeFlags: typeSpell },
    { code: ownDestroyedMonsterCode, name: "Veda Destroyed Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Veda Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2200, defense: 1000 },
    { code: destroyerCode, name: "Veda Test Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 500, defense: 500 },
    { code: responderCode, name: "Veda Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("veda responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function destroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(function(tc) return tc:IsCode(${ownDestroyedCode},${ownDestroyedMonsterCode}) end,tp,LOCATION_ONFIELD,0,1,nil) end
        local g=Duel.GetMatchingGroup(function(tc) return tc:IsCode(${ownDestroyedCode},${ownDestroyedMonsterCode}) end,tp,LOCATION_ONFIELD,0,nil)
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetMatchingGroup(function(tc) return tc:IsCode(${ownDestroyedCode},${ownDestroyedMonsterCode}) end,tp,LOCATION_ONFIELD,0,nil):GetFirst()
        if tc then Duel.Destroy(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function specialSummonedEvent(cardUid: string, sourceUid: string, effectId: number, previousLocation: string, previousSequence: number, currentSequence: number) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventUids: [cardUid],
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: previousLocation, position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: currentSequence },
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, effectId: number, previous: Record<string, unknown>, current: Record<string, unknown>) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: previous,
    eventCurrentState: current,
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
