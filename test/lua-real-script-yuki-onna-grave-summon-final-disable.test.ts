import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const yukiCode = "2645637";
const graveSummonedCode = "26456370";
const targetCode = "26456371";
const zeroAttackDecoyCode = "26456372";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasYukiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${yukiCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceZombie = 0x10;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasYukiScript)("Lua real script Yuki-Onna grave summon final disable", () => {
  it("restores Graveyard Special Summon trigger into nonzero target final ATK zero and effect negation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${yukiCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_ZOMBIE),2)");
    expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("eg:IsExists(Card.IsSummonLocation,1,e:GetHandler(),LOCATION_GRAVE)");
    expect(script).toContain("chkc:IsLocation(LOCATION_MZONE) and chkc:HasNonZeroAttack() and chkc~=c");
    expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("if not tc:IsAttack(0) then return end");
    expect(script).toContain("tc:NegateEffects(c)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 2645637, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [graveSummonedCode, zeroAttackDecoyCode], extra: [yukiCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const yuki = requireCard(session, yukiCode);
    const graveSummoned = requireCard(session, graveSummonedCode);
    const target = requireCard(session, targetCode);
    const zeroAttackDecoy = requireCard(session, zeroAttackDecoyCode);
    moveFaceUpAttack(session, yuki, 0);
    yuki.summonType = "link";
    moveDuelCard(session.state, graveSummoned.uid, "graveyard", 0);
    moveFaceUpAttack(session, target, 1);
    moveFaceUpAttack(session, zeroAttackDecoy, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yukiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, graveSummoned.uid, 0);
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === yuki.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1102",
        eventCardUid: graveSummoned.uid,
        eventCode: 1102,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: yuki.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === yuki.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);
    const disabledTarget = requireCard(restoredTrigger.session, targetCode);
    expect(currentAttack(disabledTarget, restoredTrigger.session.state)).toBe(0);
    expect(currentAttack(requireCard(restoredTrigger.session, zeroAttackDecoyCode), restoredTrigger.session.state)).toBe(0);
    expect(isCardDisabled(restoredTrigger.session.state, disabledTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredTrigger.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === disabledTarget.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 33427456 }, value: 0 },
      { code: 2, event: "continuous", reset: { flags: 33427456, count: 1 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 33427456, count: 1 }, value: 131072 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: yukiCode, name: "Yuki-Onna, the Absolute Zero Mayakashi", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceZombie, level: 4, attack: 2900, defense: 0, linkMarkers: 0x2b },
    { code: graveSummonedCode, name: "Yuki-Onna Grave Summoned Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, level: 4, attack: 0, defense: 1000 },
    { code: targetCode, name: "Yuki-Onna Nonzero Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 2400, defense: 1000 },
    { code: zeroAttackDecoyCode, name: "Yuki-Onna Zero ATK Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, level: 4, attack: 0, defense: 1000 },
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
