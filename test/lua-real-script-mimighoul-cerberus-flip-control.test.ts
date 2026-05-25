import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const cerberusCode = "23920796";
const banishMonsterCode = "239207960";
const secondBanishedCode = "239207961";
const thirdBanishedCode = "239207962";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceFiend = 0x8;
const attributeDark = 0x20;
const categoryRemove = 0x4;
const categorySpecialSummon = 0x200;
const categorySet = 0x100000000;
const categoryControl = 0x2000;
const effectCannotBeEffectTarget = 71;
const effectFlagIgnoreImmune = 0x80;

describe.skipIf(!hasUpstreamScripts)("Lua real script Mimighoul Cerberus flip control", () => {
  it("restores opponent face-down self-summon and Main Phase flip banish summon control sequence", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cerberusCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSelfSummon = createRestoredSelfSummonWindow({ reader, workspace });
    const handCerberus = requireCard(restoredSelfSummon.session, cerberusCode);
    expectCleanRestore(restoredSelfSummon);
    expect(restoredSelfSummon.session.state.effects.filter((effect) => effect.sourceUid === handCerberus.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      luaValueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { category: categoryRemove | categorySpecialSummon | categoryControl, code: undefined, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, triggerEvent: "flipSummoned", luaValueDescriptor: undefined },
      { category: categorySpecialSummon + categorySet, code: undefined, event: "ignition", property: undefined, range: ["hand"], targetRange: undefined, triggerEvent: undefined, luaValueDescriptor: undefined },
      { category: undefined, code: effectCannotBeEffectTarget, event: "continuous", property: effectFlagIgnoreImmune, range: ["monsterZone"], targetRange: [12, 0], triggerEvent: undefined, luaValueDescriptor: "cannot-be-effect-target:opponent" },
    ]);
    expectRestoredLegalActions(restoredSelfSummon, 0);
    const selfSummon = getLuaRestoreLegalActions(restoredSelfSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handCerberus.uid && action.effectId === "lua-2"
    );
    expect(selfSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSelfSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSelfSummon, selfSummon!);
    resolveRestoredChain(restoredSelfSummon);
    expect(restoredSelfSummon.session.state.cards.find((card) => card.uid === handCerberus.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: false,
      position: "faceDownDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handCerberus.uid,
      reasonEffectId: 2,
    });
    expect(restoredSelfSummon.session.state.eventHistory.map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
    }))).toContainEqual({
      eventName: "confirmed",
      eventCardUid: handCerberus.uid,
      eventPlayer: 0,
    });

    const restoredFlipOpen = createRestoredFlipWindow({ reader, workspace });
    const fieldCerberus = requireCard(restoredFlipOpen.session, cerberusCode);
    expectCleanRestore(restoredFlipOpen);
    expectRestoredLegalActions(restoredFlipOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredFlipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === fieldCerberus.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredFlipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipOpen, flip!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredFlipOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const flipTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fieldCerberus.uid && action.effectId === "lua-1"
    );
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, flipTrigger!);
    resolveRestoredChain(restoredTrigger);

    const banishedTopCards = [banishMonsterCode, secondBanishedCode, thirdBanishedCode]
      .map((code) => requireCard(restoredTrigger.session, code));
    expect(banishedTopCards.filter((card) => card.location === "banished").length).toBe(2);
    expect(banishedTopCards.filter((card) => card.location === "monsterZone" && card.controller === 1 && card.position === "faceUpDefense").length).toBe(1);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === fieldCerberus.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldCerberus.uid,
      reasonEffectId: 1,
    });
    const movementEvents = restoredTrigger.session.state.eventHistory.filter((event) => ["banished", "specialSummoned", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }));
    for (const card of banishedTopCards) {
      expect(movementEvents).toContainEqual({ eventName: "banished", eventCardUid: card.uid, eventReason: duelReason.effect, eventReasonCardUid: fieldCerberus.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 });
    }
    expect(movementEvents).toContainEqual({ eventName: "specialSummoned", eventCardUid: expect.any(String), eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: fieldCerberus.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 });
    expect(movementEvents).toContainEqual({ eventName: "controlChanged", eventCardUid: fieldCerberus.uid, eventReason: duelReason.effect, eventReasonCardUid: fieldCerberus.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 });
  });
});

function createRestoredSelfSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 23920796, { 0: { main: [cerberusCode] }, 1: { main: [] } });
  moveDuelCard(session.state, requireCard(session, cerberusCode).uid, "hand", 0);
  return registerAndRestore(session, workspace, reader);
}

function createRestoredFlipWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 23920797, { 0: { main: [cerberusCode, banishMonsterCode, secondBanishedCode, thirdBanishedCode] }, 1: { main: [] } });
  const cerberus = moveDuelCard(session.state, requireCard(session, cerberusCode).uid, "monsterZone", 0);
  cerberus.position = "faceDownDefense";
  cerberus.faceUp = false;
  return registerAndRestore(session, workspace, reader);
}

function baseSession(
  reader: ReturnType<typeof createCardReader>,
  seed: number,
  decks: Parameters<typeof loadDecks>[1],
): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, decks);
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAndRestore(
  session: DuelSession,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cerberusCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mimighoul Cerberus");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_SPECIAL_SUMMON+CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("Duel.GetDecktopGroup(tp,3)");
  expect(script).toContain("Duel.DisableShuffleCheck()");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,1-tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e2:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,1-tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ConfirmCards(tp,c)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("e3:SetValue(aux.tgoval)");
}

function cards(): DuelCardData[] {
  return [
    { code: cerberusCode, name: "Mimighoul Cerberus", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 400, defense: 1800 },
    { code: banishMonsterCode, name: "Mimighoul Cerberus Banished Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: secondBanishedCode, name: "Mimighoul Cerberus Second Banished", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: thirdBanishedCode, name: "Mimighoul Cerberus Third Banished", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
    { code: "239207963", name: "Mimighoul Cerberus Spell Probe", kind: "spell", typeFlags: typeSpell },
  ];
}

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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
