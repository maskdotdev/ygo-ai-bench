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
const lessonCode = "12940613";
const madolcheFieldCode = "129406130";
const firstGraveCode = "129406131";
const secondGraveCode = "129406132";
const offSetGraveCode = "129406133";
const opponentCode = "129406134";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLessonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lessonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const raceBeast = 0x4000;
const attributeEarth = 0x8;
const setMadolche = 0x71;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasLessonScript)("Lua real script Madolche Lesson damage step to-Deck stat", () => {
  it("restores Damage Step target shuffle, Madolche ATK/DEF update, SelectYesNo, and second shuffle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lessonCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 12940613, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lessonCode, madolcheFieldCode, firstGraveCode, secondGraveCode, offSetGraveCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const lesson = requireCard(session, lessonCode);
    const field = requireCard(session, madolcheFieldCode);
    const firstGrave = requireCard(session, firstGraveCode);
    const secondGrave = requireCard(session, secondGraveCode);
    const offSet = requireCard(session, offSetGraveCode);
    const opponent = requireCard(session, opponentCode);
    moveDuelCard(session.state, lesson.uid, "spellTrapZone", 0);
    lesson.position = "faceDown";
    lesson.faceUp = false;
    moveFaceUpAttack(session, field, 0, 0);
    moveFaceUpAttack(session, opponent, 1, 0);
    moveDuelCard(session.state, firstGrave.uid, "graveyard", 0);
    moveDuelCard(session.state, secondGrave.uid, "graveyard", 0);
    moveDuelCard(session.state, offSet.uid, "graveyard", 0);
    session.state.turn = 2;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lessonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === field.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passRestoredBattleAction(restoredOpen, 1, "passAttack");
    passRestoredBattleAction(restoredOpen, 0, "passAttack");
    passRestoredBattleAction(restoredOpen, 1, "passDamage");

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === lesson.uid && action.effectId === "lua-1-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 207049808, returned: true });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === firstGrave.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: lesson.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === secondGrave.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: lesson.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === offSet.uid)).toMatchObject({ location: "graveyard" });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === field.uid), restoredOpen.session.state)).toBe(1800);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === field.uid), restoredOpen.session.state)).toBe(2000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectUpdateAttack || effect.code === effectUpdateDefense).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: field.uid, value: 800 },
      { code: effectUpdateDefense, reset: { flags: 33427456 }, sourceUid: field.uid, value: 800 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: firstGrave.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: lesson.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "deck" },
      { eventCardUid: secondGrave.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: lesson.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "deck" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Madolche Lesson");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TODECK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter1,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TODECK,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("Duel.BreakEffect()");
}

function cards(): DuelCardData[] {
  return [
    { code: lessonCode, name: "Madolche Lesson", kind: "trap", typeFlags: typeTrap, setcodes: [setMadolche] },
    { code: madolcheFieldCode, name: "Madolche Lesson Field Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1200, setcodes: [setMadolche] },
    { code: firstGraveCode, name: "Madolche Lesson First Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1400, defense: 800, setcodes: [setMadolche] },
    { code: secondGraveCode, name: "Madolche Lesson Second Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1300, defense: 900, setcodes: [setMadolche] },
    { code: offSetGraveCode, name: "Madolche Lesson Off-Set Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000, setcodes: [0x123] },
    { code: opponentCode, name: "Madolche Lesson Opponent Battler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 900, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  expectRestoredLegalActions(restored, player);
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
