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
const armityleFuryCode = "60110982";
const originalArmityleCode = "43378048";
const materialCodes = ["6007213", "32491822", "69890967"] as const;
const fieldDecoyCode = "601109820";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasArmityleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${armityleFuryCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFiend = 0x8;
const attributeDark = 0x20;
const categoryRemove = 0x4;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const effectChangeCode = 114;
const eventControlChanged = 1120;
const eventPhaseEnd = 0x1200;
const effectFlagSingleRange = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasArmityleScript)("Lua real script Armityle Phantom of Fury control end summon", () => {
  it("restores AddProcMix metadata, self-control transfer, delayed End Phase banish, and original Armityle summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${armityleFuryCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 60110982, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [armityleFuryCode, fieldDecoyCode], extra: [originalArmityleCode, ...materialCodes] },
      1: { main: [] },
    });
    startDuel(session);

    const fury = requireCard(session, armityleFuryCode);
    const decoy = requireCard(session, fieldDecoyCode);
    const originalArmityle = requireCard(session, originalArmityleCode);
    moveFaceUpAttack(session, fury, 0);
    moveFaceUpAttack(session, decoy, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(armityleFuryCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(fury.data.fusionMaterials).toEqual([...materialCodes]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fury.uid)?.data.fusionMaterials).toEqual([...materialCodes]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fury.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: effectChangeCode, countLimit: undefined, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], triggerEvent: undefined, value: Number(originalArmityleCode) },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: eventControlChanged, countLimit: 1, event: "continuous", property: 259, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "controlChanged", value: undefined },
    ]);
    expectRestoredLegalActions(restoredOpen, 0);
    const giveControl = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fury.uid && action.effectId === "lua-3"
    );
    expect(giveControl, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, giveControl!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === fury.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fury.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.effects.some((effect) =>
      effect.sourceUid === fury.uid
      && effect.event === "trigger"
      && effect.code === eventPhaseEnd
      && effect.category === (categorySpecialSummon | categoryRemove)
    )).toBe(true);

    const restoredPostControl = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredPostControl);
    expectRestoredLegalActions(restoredPostControl, 0);
    changePhase(restoredPostControl, 0, "battle");
    changePhase(restoredPostControl, 0, "main2");
    changePhase(restoredPostControl, 0, "end");
    expect(restoredPostControl.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-4608", eventCode: eventPhaseEnd, eventName: "phaseEnd", player: 1, sourceUid: fury.uid, triggerBucket: "opponentMandatory" },
    ]);

    const endTrigger = getLuaRestoreLegalActions(restoredPostControl, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === fury.uid && action.effectId === "lua-5-4608"
    );
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPostControl, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPostControl, endTrigger!);

    const restoredEndChain = restoreDuelWithLuaScripts(serializeDuel(restoredPostControl.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredEndChain);
    expectRestoredLegalActions(restoredEndChain, 0);
    resolveRestoredChain(restoredEndChain);

    expect(restoredEndChain.session.state.cards.find((card) => card.uid === fury.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 1,
      reasonCardUid: fury.uid,
      reasonEffectId: 5,
    });
    expect(restoredEndChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredEndChain.session.state.cards.find((card) => card.uid === originalArmityle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fury.uid,
      reasonEffectId: 5,
    });
    expect(restoredEndChain.session.state.eventHistory.filter((event) => ["controlChanged", "banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "controlChanged", eventCode: eventControlChanged, eventCardUid: fury.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fury.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: fury.uid, eventReason: duelReason.effect, eventReasonPlayer: 1, eventReasonCardUid: fury.uid, eventReasonEffectId: 5, previousLocation: "monsterZone", currentLocation: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: originalArmityle.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: fury.uid, eventReasonEffectId: 5, previousLocation: "extraDeck", currentLocation: "monsterZone" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Armityle the Chaos Phantasm - Phantom of Fury");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,6007213,32491822,69890967)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
  expect(script).toContain("e1:SetValue(43378048)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e3:SetCode(EVENT_CONTROL_CHANGED)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_REMOVE)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.Remove(rg,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectYesNo(p,aux.Stringid(id,1))");
  expect(script).toContain("Duel.SpecialSummon(sg,0,p,p,true,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: armityleFuryCode, name: "Armityle the Chaos Phantasm - Phantom of Fury", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 12, attack: 0, defense: 0 },
    { code: originalArmityleCode, name: "Armityle the Chaos Phantasm", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 12, attack: 0, defense: 0 },
    { code: fieldDecoyCode, name: "Armityle End Phase Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    ...materialCodes.map((code, index): DuelCardData => ({
      code,
      name: `Armityle Material ${index + 1}`,
      kind: "monster",
      typeFlags: typeMonster,
      race: raceFiend,
      attribute: attributeDark,
      level: 10,
      attack: 0,
      defense: 0,
    })),
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}
