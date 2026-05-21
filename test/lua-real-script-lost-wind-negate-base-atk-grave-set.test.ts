import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const lostWindCode = "74003290";
const targetCode = "740032900";
const extraSummonedCode = "740032901";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLostWindScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lostWindCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasLostWindScript)("Lua real script Lost Wind negate base ATK grave set", () => {
  it("restores special-summoned target negation/base ATK halve and opponent Extra Deck summon grave self-set redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lostWindCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 74003290, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lostWindCode] }, 1: { main: [targetCode], extra: [extraSummonedCode] } });
    startDuel(session);

    const lostWind = requireCard(session, lostWindCode);
    const target = requireCard(session, targetCode);
    const extraSummoned = requireCard(session, extraSummonedCode);
    moveFaceDownTrap(session, lostWind);
    moveFaceUpAttack(session, target, 1);
    target.summonType = "special";
    target.summonPlayer = 1;
    target.previousLocation = "hand";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lostWindCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lostWind.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1200);
    expectLuaTargetProbe(restoredOpen, targetCode, "lost wind probe 740032900/1200/true");
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [2, 8, 103].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 2, reset: { flags: 33427456 }, sourceUid: target.uid, value: undefined },
      { code: 8, reset: { flags: 33427456 }, sourceUid: target.uid, value: 131072 },
      { code: 103, reset: { flags: 33427456 }, sourceUid: target.uid, value: 1200 },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lostWind.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" && event.eventCardUid === target.uid)).toHaveLength(1);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredGrave);
    moveFaceUpAttack(restoredGrave.session, extraSummoned, 1);
    const restoredExtra = restoredGrave.session.state.cards.find((card) => card.uid === extraSummoned.uid)!;
    restoredExtra.summonType = "fusion";
    restoredExtra.summonPlayer = 1;
    restoredExtra.previousLocation = "extraDeck";
    restoredExtra.previousController = 1;
    const raised = restoredGrave.host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${extraSummonedCode}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
        Duel.RaiseEvent(c,EVENT_SPSUMMON_SUCCESS,nil,REASON_SPSUMMON,1,1,0)
        Debug.Message("lost wind extra summon success raised")
      `,
      "lost-wind-extra-summon-success.lua",
    );
    expect(raised.ok, raised.error).toBe(true);
    expect(restoredGrave.host.messages).toContain("lost wind extra summon success raised");

    const restoredSetWindow = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), workspace, reader);
    expectCleanRestore(restoredSetWindow);
    expectRestoredLegalActions(restoredSetWindow, 0);
    const setTrigger = getLuaRestoreLegalActions(restoredSetWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === lostWind.uid);
    expect(setTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSetWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetWindow, setTrigger!);
    passRestoredChain(restoredSetWindow);
    expect(restoredSetWindow.session.state.cards.find((card) => card.uid === lostWind.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredSetWindow.session.state.effects.filter((effect) => effect.sourceUid === lostWind.uid && effect.code === 60).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 60, property: 0x400 | 0x4000000, reset: { flags: 209326080 }, value: 0x20 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("aux.StatChangeDamageStepCondition");
  expect(script).toContain("return c:IsFaceup() and c:IsSpecialSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("Duel.AdjustInstantly(tc)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_BASE_ATTACK)");
  expect(script).toContain("e3:SetValue(tc:GetBaseAttack()/2)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SET)");
  expect(script).toContain("return c:IsSummonLocation(LOCATION_EXTRA) and c:IsPreviousControler(1-tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SSet(tp,c)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");
}

function cards(): DuelCardData[] {
  return [
    { code: lostWindCode, name: "Lost Wind", kind: "trap", typeFlags: typeTrap },
    { code: targetCode, name: "Lost Wind Special Summoned Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1600 },
    { code: extraSummonedCode, name: "Lost Wind Opponent Extra Summon", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 6, attack: 2100, defense: 1800 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
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

function expectLuaTargetProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local tc=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("lost wind probe " .. tc:GetCode() .. "/" .. tc:GetBaseAttack() .. "/" .. tostring(tc:IsDisabled()))
    `,
    "lost-wind-target-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
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
