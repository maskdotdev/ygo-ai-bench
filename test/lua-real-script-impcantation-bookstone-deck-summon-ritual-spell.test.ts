import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const candollCode = "53303460";
const bookstoneCode = "18474999";
const ritualCostSpellCode = "184749990";
const ritualSpellCode = "184749991";
const spellDecoyCode = "184749992";
const responderCode = "184749993";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Impcantation Bookstone Deck summon Ritual Spell", () => {
  it("restores Deck-summoned Bookstone trigger targeting a Ritual Spell in Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const candollScript = workspace.readScript(`c${candollCode}.lua`);
    const bookstoneScript = workspace.readScript(`c${bookstoneCode}.lua`);
    expect(candollScript).toContain("Duel.ShuffleHand(tp)");
    expect(candollScript).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(bookstoneScript).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_DECK)");
    expect(bookstoneScript).toContain("return c:IsRitualSpell() and c:IsAbleToHand()");
    expect(bookstoneScript).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(bookstoneScript).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
    expect(bookstoneScript).toContain("aux.addContinuousLizardCheck(c,LOCATION_MZONE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === candollCode || card.code === bookstoneCode),
      { code: ritualCostSpellCode, name: "Bookstone Ritual Spell Reveal Cost", kind: "spell", typeFlags: typeSpell | typeRitual },
      { code: ritualSpellCode, name: "Bookstone Ritual Spell Target", kind: "spell", typeFlags: typeSpell | typeRitual },
      { code: spellDecoyCode, name: "Bookstone Normal Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Bookstone Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18474999, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [candollCode, ritualCostSpellCode, bookstoneCode, ritualSpellCode, spellDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const candoll = requireCard(session, candollCode);
    const bookstone = requireCard(session, bookstoneCode);
    const ritualCostSpell = requireCard(session, ritualCostSpellCode);
    const ritualSpell = requireCard(session, ritualSpellCode);
    const spellDecoy = requireCard(session, spellDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, candoll.uid, "hand", 0);
    moveDuelCard(session.state, ritualCostSpell.uid, "hand", 0);
    moveDuelCard(session.state, ritualSpell.uid, "graveyard", 0);
    moveDuelCard(session.state, spellDecoy.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const script = workspace.readScript(name);
        if (script === undefined) throw new Error(`Missing script ${name}`);
        return script;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [candollCode, bookstoneCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const special = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === candoll.uid);
    expect(special, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, special!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: candoll.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, targetUids: [], count: 2, player: 0, parameter: 0x3 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("bookstone responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === candoll.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === bookstone.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(restoredChain.session.state.pendingTriggers).toHaveLength(1);
    const pendingBookstoneSearch = restoredChain.session.state.pendingTriggers[0]!;
    expect(pendingBookstoneSearch).toEqual({
      id: pendingBookstoneSearch.id,
      effectId: pendingBookstoneSearch.effectId,
      sourceUid: bookstone.uid,
      player: 0,
      triggerBucket: "turnOptional",
      eventName: "specialSummoned",
      eventCode: 1102,
      eventPlayer: 0,
      eventCardUid: bookstone.uid,
      eventUids: [bookstone.uid, candoll.uid],
      eventReason: duelReason.summon | duelReason.specialSummon,
      eventReasonPlayer: 0,
      eventReasonCardUid: candoll.uid,
      eventReasonEffectId: 1,
      eventTriggerTiming: "if",
      eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
      eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === bookstone.uid).map((effect) => effect.luaTargetDescriptor)).toContain("special-summon-limit:extra");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === bookstone.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        sourceUid: bookstone.uid,
        player: 0,
        effectId: "lua-6-1102",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: bookstone.uid,
        eventUids: [bookstone.uid, candoll.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: candoll.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        targetFieldIds: [9],
        targetUids: [ritualSpell.uid],
        operationInfos: [{ category: 0x8, targetUids: [ritualSpell.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 1);
    resolveRestoredChain(restoredSearch);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === ritualSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: bookstone.uid,
      reasonEffectId: 6,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredSearch.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === ritualSpell.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: ritualSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bookstone.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
    ]);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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
      e:SetOperation(function(e,tp) Debug.Message("bookstone responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
