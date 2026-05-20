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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const lerajeCode = "49922726";
const hasLerajeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lerajeCode}.lua`));
const warriorGraveCode = "499227260";
const spellcasterGraveCode = "499227261";
const dragonGraveCode = "499227262";
const targetCode = "499227263";
const typeMonster = 0x1;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLerajeScript)("Lua real script Leraje summon race stat target destroy", () => {
  it("restores summon race-count ATK gain into cannot-attack target DEF zero destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lerajeCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsMonster,tp,LOCATION_GRAVE,0,nil):GetClassCount(Card.GetRace)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(100*ct)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.desfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetValue(-c:GetAttack())");
    expect(script).toContain("if def~=0 and tc:IsDefense(0) then");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lerajeCode),
      { code: warriorGraveCode, name: "Leraje Warrior Grave", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: spellcasterGraveCode, name: "Leraje Spellcaster Grave", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, level: 4, attack: 1000, defense: 1000 },
      { code: dragonGraveCode, name: "Leraje Dragon Grave", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 4, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Leraje DEF Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1200, defense: 2100 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 49922726, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lerajeCode, warriorGraveCode, spellcasterGraveCode, dragonGraveCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const leraje = requireCard(session, lerajeCode);
    const warriorGrave = requireCard(session, warriorGraveCode);
    const spellcasterGrave = requireCard(session, spellcasterGraveCode);
    const dragonGrave = requireCard(session, dragonGraveCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, leraje.uid, "hand", 0);
    moveDuelCard(session.state, warriorGrave.uid, "graveyard", 0);
    moveDuelCard(session.state, spellcasterGrave.uid, "graveyard", 0);
    moveDuelCard(session.state, dragonGrave.uid, "graveyard", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpDefense";
    target.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lerajeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === leraje.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonWindow, summon!);
    expect(restoredSummonWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: leraje.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: leraje.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), workspace, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === leraje.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([]);
    expect(currentAttack(restoredTriggerWindow.session.state.cards.find((card) => card.uid === leraje.uid), restoredTriggerWindow.session.state)).toBe(2100);
    expect(restoredTriggerWindow.session.state.effects.filter((effect) => effect.sourceUid === leraje.uid && effect.code === 100)).toEqual([
      expect.objectContaining({ code: 100, controller: 0, event: "continuous", range: ["monsterZone"], sourceUid: leraje.uid, value: 300 }),
    ]);

    const restoredIgnitionWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), workspace, reader);
    expectCleanRestore(restoredIgnitionWindow);
    expectRestoredLegalActions(restoredIgnitionWindow, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnitionWindow, 0).find((action) => action.type === "activateEffect" && action.uid === leraje.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnitionWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredIgnitionWindow, ignition!);

    expect(restoredIgnitionWindow.session.state.chain).toEqual([]);
    expect(restoredIgnitionWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      previousDefense: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: leraje.uid,
      reasonEffectId: 2,
    });
    expect(restoredIgnitionWindow.session.state.effects.filter((effect) => effect.sourceUid === leraje.uid && effect.code === 85)).toEqual([
      expect.objectContaining({ code: 85, controller: 0, event: "continuous", range: ["monsterZone"], sourceUid: leraje.uid }),
    ]);
    expect(restoredIgnitionWindow.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "destroyed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: leraje.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-5",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: leraje.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpDefense", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: leraje.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    expect(restoredIgnitionWindow.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
