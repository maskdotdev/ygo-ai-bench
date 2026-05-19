import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const quickSpanCode = "11287364";
const hasQuickSpanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${quickSpanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const categoryAtkChange = 0x200000;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts || !hasQuickSpanScript)("Lua real script Quick-Span Knight Synchro material ATK target", () => {
  it("restores its Synchro material trigger, opponent target prompt, and ATK reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const partnerCode = "11287365";
    const synchroCode = "11287366";
    const targetCode = "11287367";
    const script = workspace.readScript(`c${quickSpanCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and r==REASON_SYNCHRO");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e) and tc:IsFaceup()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
    expect(script).toContain("e1:SetValue(-500)");

    const cards: DuelCardData[] = [
      { code: quickSpanCode, name: "Quick-Span Knight", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, level: 2, attack: 1000, defense: 800 },
      { code: partnerCode, name: "Quick-Span Synchro Partner", kind: "monster", typeFlags: typeMonster, level: 2, attack: 900, defense: 900 },
      { code: synchroCode, name: "Quick-Span Synchro Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 4, attack: 2200, defense: 1800 },
      { code: targetCode, name: "Quick-Span Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1128, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [quickSpanCode, partnerCode], extra: [synchroCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const quickSpan = requireCard(session, quickSpanCode);
    const partner = requireCard(session, partnerCode);
    const synchro = requireCard(session, synchroCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, quickSpan, 0);
    moveFaceUpAttack(session, partner, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(quickSpanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === quickSpan.uid && effect.code === eventBeMaterial)).toMatchObject({
      category: categoryAtkChange,
      code: eventBeMaterial,
      event: "trigger",
      property: 0x10,
      sourceUid: quickSpan.uid,
      triggerEvent: "usedAsMaterial",
      triggerSourceOnly: true,
    });

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchroAction = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "synchroSummon" && action.uid === synchro.uid && action.materialUids.includes(quickSpan.uid) && action.materialUids.includes(partner.uid),
    );
    expect(synchroAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    synchroSummonDuelCard(restoredOpen.session.state, 0, synchro.uid, [quickSpan.uid, partner.uid]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === quickSpan.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.material | duelReason.synchro,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
      summonMaterialUids: [quickSpan.uid, partner.uid],
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial" && event.eventCardUid === quickSpan.uid)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventPreviousState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCardUid: quickSpan.uid,
      },
    ]);
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: quickSpan.uid,
        eventName: "usedAsMaterial",
        eventReason: duelReason.synchro,
        eventReasonCardUid: synchro.uid,
        player: 0,
        sourceUid: quickSpan.uid,
        triggerBucket: "turnMandatory",
      },
    ]);
    expect(currentAttack(target, restoredOpen.session.state)).toBe(1800);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === quickSpan.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), restoredTrigger.session.state)).toBe(1300);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(1300);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
