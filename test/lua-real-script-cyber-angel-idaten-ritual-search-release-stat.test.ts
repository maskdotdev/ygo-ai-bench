import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel, createDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const idatenCode = "3629090";
const ritualSpellCode = "3629091";
const ritualAllyCode = "3629092";
const decoySpellCode = "3629093";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;
const luaSummonTypeRitual = 0x45000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber Angel Idaten ritual search release stat", () => {
  it("restores ritual summon NecroValley search and release trigger Ritual Monster stat boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${idatenCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsRitualSummoned()");
    expect(script).toContain("return c:IsRitualSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetCode(EVENT_RELEASE)");
    expect(script).toContain("return c:IsFaceup() and c:IsRitualMonster()");
    expect(script).toContain("Duel.GetMatchingGroup(s.adfilter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === idatenCode),
      { code: ritualSpellCode, name: "Idaten Ritual Spell", kind: "spell", typeFlags: typeSpell | typeRitual },
      { code: ritualAllyCode, name: "Idaten Ritual Ally", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, level: 6, attack: 1800, defense: 1200 },
      { code: decoySpellCode, name: "Idaten Non-Ritual Spell Decoy", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === "idaten-release-probe.lua") return releaseProbeScript(idatenCode);
        return workspace.readScript(name);
      },
    };

    const searchSession = createDuel({ seed: 3629090, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(searchSession, { 0: { main: [idatenCode, ritualSpellCode, decoySpellCode] }, 1: { main: [] } });
    startDuel(searchSession);
    const searchIdaten = requireCard(searchSession.state.cards, idatenCode);
    const ritualSpell = requireCard(searchSession.state.cards, ritualSpellCode);
    const searchHost = createLuaScriptHost(searchSession, workspace);
    expect(searchHost.loadCardScript(Number(idatenCode), source).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);
    const previousIdatenState = cardEventState(searchIdaten);
    specialSummonDuelCard(searchSession.state, searchIdaten.uid, 0, 0, {}, luaSummonTypeRitual);
    const currentIdatenState = { ...previousIdatenState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 };

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(searchSession), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const pendingSearch = restoredTriggerWindow.session.state.pendingTriggers[0];
    expect(pendingSearch).toBeDefined();
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: pendingSearch!.effectId,
        sourceUid: searchIdaten.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: searchIdaten.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: previousIdatenState,
        eventCurrentState: currentIdatenState,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === searchIdaten.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.chain).toEqual([]);
    expect(restoredTriggerWindow.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === ritualSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchIdaten.uid,
      reasonEffectId: 2,
    });
    expect(restoredTriggerWindow.host.messages).toEqual([`confirmed 1: ${ritualSpellCode}`]);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: searchIdaten.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: previousIdatenState,
        eventCurrentState: currentIdatenState,
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: ritualSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: searchIdaten.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [ritualSpell.uid],
        eventValue: 1,
        eventCardUid: ritualSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: searchIdaten.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: [ritualSpell.uid],
        eventValue: 1,
        eventCardUid: ritualSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: searchIdaten.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const releaseSession = createDuel({ seed: 3629091, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(releaseSession, { 0: { main: [idatenCode, ritualAllyCode] }, 1: { main: [] } });
    startDuel(releaseSession);
    const releasedIdaten = requireCard(releaseSession.state.cards, idatenCode);
    const ritualAlly = requireCard(releaseSession.state.cards, ritualAllyCode);
    moveDuelCard(releaseSession.state, releasedIdaten.uid, "monsterZone", 0).position = "faceUpAttack";
    releasedIdaten.faceUp = true;
    moveDuelCard(releaseSession.state, ritualAlly.uid, "monsterZone", 0).position = "faceUpAttack";
    ritualAlly.faceUp = true;
    releaseSession.state.phase = "main1";
    releaseSession.state.turnPlayer = 0;
    releaseSession.state.waitingFor = 0;

    const releaseHost = createLuaScriptHost(releaseSession, workspace);
    expect(releaseHost.loadCardScript(Number(idatenCode), source).ok).toBe(true);
    expect(releaseHost.registerInitialEffects()).toBe(1);
    const previousReleasedState = cardEventState(releasedIdaten);
    const releaseProbe = releaseHost.loadScript(releaseProbeScript(idatenCode), "idaten-release-probe.lua");
    expect(releaseProbe.ok, releaseProbe.error).toBe(true);
    expect(releaseHost.messages).toContain("idaten released 1");

    const restoredReleaseTrigger = restoreDuelWithLuaScripts(serializeDuel(releaseSession), source, reader);
    expectCleanRestore(restoredReleaseTrigger);
    expectRestoredLegalActions(restoredReleaseTrigger, 0);
    const pendingRelease = restoredReleaseTrigger.session.state.pendingTriggers[0];
    expect(pendingRelease).toBeDefined();
    expect(restoredReleaseTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: pendingRelease!.effectId,
        sourceUid: releasedIdaten.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "released",
        eventCode: 1017,
        eventCardUid: releasedIdaten.uid,
        eventReason: duelReason.effect | duelReason.release,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: previousReleasedState,
        eventCurrentState: { ...previousReleasedState, location: "graveyard" },
      },
    ]);
    const releaseTrigger = getLuaRestoreLegalActions(restoredReleaseTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === releasedIdaten.uid);
    expect(releaseTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredReleaseTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReleaseTrigger, releaseTrigger!);

    expect(restoredReleaseTrigger.session.state.chain).toEqual([]);
    expect(restoredReleaseTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(currentAttack(restoredReleaseTrigger.session.state.cards.find((card) => card.uid === ritualAlly.uid), restoredReleaseTrigger.session.state)).toBe(2800);
    expect(currentDefense(restoredReleaseTrigger.session.state.cards.find((card) => card.uid === ritualAlly.uid), restoredReleaseTrigger.session.state)).toBe(2200);
    expect(restoredReleaseTrigger.session.state.eventHistory.filter((event) => event.eventName === "released")).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: releasedIdaten.uid,
        eventReason: duelReason.effect | duelReason.release,
        eventReasonPlayer: 0,
        eventPreviousState: previousReleasedState,
        eventCurrentState: { ...previousReleasedState, location: "graveyard" },
      },
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function releaseProbeScript(code: string): string {
  return `
    local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${code}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
    Debug.Message("idaten released " .. Duel.Release(c, REASON_EFFECT))
  `;
}
