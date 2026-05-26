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
const chronicleCode = "60948488";
const summonProbeCode = "609484880";
const darkMagicianCode = "46986414";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChronicleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chronicleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeNormal = 0x10;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasChronicleScript)("Lua real script Chronicle Magician summon target stat", () => {
  it("restores 2500-base summon trigger into hand self-summon and Dark Magician ATK/DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chronicleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const chronicle = requireCard(restoredSummon.session, chronicleCode);
    const summonProbe = requireCard(restoredSummon.session, summonProbeCode);
    const normalSummon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === summonProbe.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, normalSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summonTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === chronicle.uid && action.effectId === "lua-1-1100"
    );
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, summonTrigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === chronicle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: chronicle.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: summonProbe.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: chronicle.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: chronicle.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const darkMagician = requireCard(restoredStat.session, darkMagicianCode);
    const statTrigger = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === chronicle.uid && action.effectId === "lua-3-1102"
    );
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statTrigger!);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === darkMagician.uid), restoredStat.session.state)).toBe(5000);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === darkMagician.uid), restoredStat.session.state)).toBe(4600);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: darkMagician.uid,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
      },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: chronicleCode, name: "Chronicle Magician", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 7, attack: 2500, defense: 2500 },
    { code: summonProbeCode, name: "Chronicle 2500 Base Summon Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 2500, defense: 1000 },
    { code: darkMagicianCode, name: "Dark Magician", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceSpellcaster, attribute: attributeDark, level: 7, attack: 2500, defense: 2100 },
  ];
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 60948488, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [chronicleCode, summonProbeCode, darkMagicianCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, chronicleCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, summonProbeCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, darkMagicianCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(chronicleCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Chronicle Magician");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("c:GetBaseAttack()==2500 or c:GetBaseDefense()==2500");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return c:IsCode(CARD_DARK_MAGICIAN,CARD_BLUEEYES_W_DRAGON) and c:IsFaceup()");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e1:SetValue(2500)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
