import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const phobosCode = "76078185";
const targetCode = "760781850";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPhobosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${phobosCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const categoryDisable = 0x2000;
const categoryControl = 0x4000;
const effectFlagCardTarget = 0x10;
const raceFiend = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasPhobosScript)("Lua real script Phobos Covos ignition negate", () => {
  it("restores non-quick Xyz ignition targeting into monster negation without battle control branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${phobosCode}.lua`);
    expect(script).toContain("--Heretical Phobos Covos");
    expect(script).toContain("Xyz.AddProcedure(c,nil,4,2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE+CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetCondition(aux.NOT(s.quickcon))");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("aux.GlobalCheck(s,function()");
    expect(script).toContain("return c:IsType(TYPE_EFFECT) and c:IsNegatableMonster()");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_CONTROL,g,1,tp,0)");
    expect(script).toContain("tc:NegateEffects(c)");
    expect(script).toContain("Duel.AdjustInstantly(tc)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 76078185, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [phobosCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const phobos = requireCard(session, phobosCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, phobos, 0, 0);
    phobos.summonType = "xyz";
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(phobosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      effect.sourceUid === phobos.uid && effect.code !== 31 && effect.code !== 1138
    ).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      {
        category: categoryDisable | categoryControl,
        code: undefined,
        countLimit: 1,
        event: "ignition",
        property: effectFlagCardTarget,
        range: ["monsterZone"],
        targetRange: undefined,
        triggerEvent: undefined,
        value: undefined,
      },
      {
        category: categoryDisable | categoryControl,
        code: 1002,
        countLimit: 1,
        event: "quick",
        property: effectFlagCardTarget,
        range: ["monsterZone"],
        targetRange: undefined,
        triggerEvent: undefined,
        value: undefined,
      },
      {
        category: undefined,
        code: 42,
        countLimit: undefined,
        event: "continuous",
        property: undefined,
        range: ["monsterZone"],
        targetRange: [4, 4],
        triggerEvent: undefined,
        value: 1,
      },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === phobos.uid && action.effectId === "lua-2"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? 0);
    passRestoredChain(restoredChain);

    const disabledTarget = findCard(restoredChain.session, target.uid);
    expect(disabledTarget).toMatchObject({
      controller: 1,
      location: "monsterZone",
    });
    expect(isCardDisabled(restoredChain.session.state, disabledTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, event: "continuous", reset: { flags: 33427456, count: 1 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 33427456, count: 1 }, value: 131072 },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 1, currentController: 1 },
    ]);

    const restoredDisabled = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredDisabled);
    expectRestoredLegalActions(restoredDisabled, restoredDisabled.session.state.waitingFor ?? restoredDisabled.session.state.turnPlayer);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: phobosCode, name: "Heretical Phobos Covos", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceFiend, level: 4, attack: 2100, defense: 1500 },
    { code: targetCode, name: "Phobos Covos Negate Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
