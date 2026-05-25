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
import type { LuaPromptOverride } from "#lua/host-types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const fairyCode = "43066927";
const faceupMimighoulCode = "430669270";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFairyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fairyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFlip = 0x200000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setMimighoul = 0x1b5;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const categorySet = 0x100000000;
const effectCannotActivate = 6;
const effectFlagPlayerTarget = 0x800;
const effectFlagClientHint = 0x4000000;

describe.skipIf(!hasUpstreamScripts || !hasFairyScript)("Lua real script Mimighoul Fairy lock control summon", () => {
  it("restores SelectEffect self-summon and FLIP activation lock before control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fairyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const summonOpen = createRestoredSelfSummonWindow({ reader, workspace });
    const handFairy = requireCard(summonOpen.session, fairyCode);
    expectCleanRestore(summonOpen);
    expect(summonOpen.session.state.effects.filter((effect) => effect.sourceUid === handFairy.uid).map((effect) => ({
      category: effect.category,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, countLimit: 1, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { category: categorySpecialSummon + categorySet, countLimit: 1, event: "ignition", range: ["hand"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(summonOpen, 0);
    const selfSummon = getLuaRestoreLegalActions(summonOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handFairy.uid && action.effectId === "lua-2"
    );
    expect(selfSummon, JSON.stringify(getLuaRestoreLegalActions(summonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summonOpen, selfSummon!);
    resolveRestoredChain(summonOpen);
    expect(summonOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      options: "options" in prompt ? prompt.options : [],
      returned: "returned" in prompt ? prompt.returned : undefined,
    }))).toEqual([{ api: "SelectEffect", player: 0, options: [1, 2], returned: 2 }]);
    expect(summonOpen.session.state.cards.find((card) => card.uid === handFairy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handFairy.uid,
      reasonEffectId: 2,
    });

    const flipOpen = createRestoredFlipWindow({ reader, workspace });
    const fieldFairy = requireCard(flipOpen.session, fairyCode);
    expectCleanRestore(flipOpen);
    expectRestoredLegalActions(flipOpen, 0);
    const flip = getLuaRestoreLegalActions(flipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === fieldFairy.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(flipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(flipOpen, flip!);

    const triggerWindow = restoreDuelWithLuaScripts(serializeDuel(flipOpen.session), workspace, reader);
    expectCleanRestore(triggerWindow);
    expectRestoredLegalActions(triggerWindow, 0);
    const flipTrigger = getLuaRestoreLegalActions(triggerWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fieldFairy.uid && action.effectId === "lua-1"
    );
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(triggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(triggerWindow, flipTrigger!);

    resolveRestoredChain(triggerWindow);
    const lockWindow = restoreDuelWithLuaScripts(serializeDuel(triggerWindow.session), workspace, reader);
    expectCleanRestore(lockWindow);
    expectRestoredLegalActions(lockWindow, 0);

    expect(lockWindow.session.state.effects.find((effect) =>
      effect.code === effectCannotActivate && effect.targetRange?.[0] === 1 && effect.targetRange?.[1] === 0
    )).toMatchObject({
      code: effectCannotActivate,
      event: "continuous",
      property: effectFlagPlayerTarget | effectFlagClientHint,
      targetRange: [1, 0],
    });
    expect(lockWindow.session.state.cards.find((card) => card.uid === fieldFairy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldFairy.uid,
      reasonEffectId: 1,
    });
    expect(lockWindow.session.state.eventHistory.filter((event) => ["flipSummoned", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "flipSummoned", eventCode: 1101, eventCardUid: fieldFairy.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: fieldFairy.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fieldFairy.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "monsterZone" },
    ]);
  });
});

function createRestoredSelfSummonWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 43066927, { 0: { main: [fairyCode, faceupMimighoulCode] }, 1: { main: [] } });
  moveDuelCard(session.state, requireCard(session, fairyCode).uid, "hand", 0);
  const mimighoul = moveDuelCard(session.state, requireCard(session, faceupMimighoulCode).uid, "monsterZone", 0);
  mimighoul.faceUp = true;
  mimighoul.position = "faceUpAttack";
  return registerAndRestore(session, workspace, reader, [{ api: "SelectEffect", player: 0, returned: 2 }]);
}

function createRestoredFlipWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 43066928, { 0: { main: [fairyCode] }, 1: { main: [] } });
  const fairy = moveDuelCard(session.state, requireCard(session, fairyCode).uid, "monsterZone", 0);
  fairy.faceUp = false;
  fairy.position = "faceDownDefense";
  return registerAndRestore(session, workspace, reader, []);
}

function baseSession(reader: ReturnType<typeof createCardReader>, seed: number, decks: Parameters<typeof loadDecks>[1]): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, decks);
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAndRestore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>, promptOverrides: LuaPromptOverride[]): ReturnType<typeof restoreDuelWithLuaScripts> {
  const host = createLuaScriptHost(session, workspace, { promptOverrides });
  expect(host.loadCardScript(Number(fairyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mimighoul Fairy");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsMainPhase() end)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_SET)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,1-tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: fairyCode, name: "Mimighoul Fairy", kind: "monster", typeFlags: typeMonster | typeEffect | typeFlip, race: raceFiend, attribute: attributeDark, setcodes: [setMimighoul], level: 1, attack: 100, defense: 100 },
    { code: faceupMimighoulCode, name: "Mimighoul Fairy Face-Up Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setMimighoul], level: 1, attack: 500, defense: 500 },
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
  const waitingFor = restored.session.state.waitingFor;
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
