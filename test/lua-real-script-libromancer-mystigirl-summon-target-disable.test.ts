import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mystigirlCode = "52707042";
const targetCode = "527070420";
const zeroAttackDecoyCode = "527070421";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMystigirlScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mystigirlCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMystigirlScript)("Lua real script Libromancer Mystigirl summon target disable", () => {
  it("restores Special Summon trigger into opponent target final ATK zero and effect negation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mystigirlCode}.lua`);
    expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("c:GetMaterial():IsExists(Card.IsLocation,1,nil,LOCATION_MZONE)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("return aux.tgoval(e,re,rp) and re:IsMonsterEffect()");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mystigirlCode),
      { code: targetCode, name: "Mystigirl Negatable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: zeroAttackDecoyCode, name: "Mystigirl Zero ATK Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 0, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 52707042, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mystigirlCode] }, 1: { main: [targetCode, zeroAttackDecoyCode] } });
    startDuel(session);

    const mystigirl = requireCard(session, mystigirlCode);
    const target = requireCard(session, targetCode);
    const zeroAttackDecoy = requireCard(session, zeroAttackDecoyCode);
    moveFaceUpAttack(session, mystigirl, 0);
    mystigirl.summonType = "ritual";
    moveFaceUpAttack(session, target, 1);
    moveFaceUpAttack(session, zeroAttackDecoy, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mystigirlCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === mystigirl.uid && effect.code === 71)).toMatchObject({
      property: 0x80,
      range: ["monsterZone"],
      targetRange: [0x4, 0],
    });

    const summonSuccess = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${mystigirlCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(c, EVENT_SPSUMMON_SUCCESS, nil, REASON_SPSUMMON, 0, 0, 0)
      Debug.Message("libromancer mystigirl summon success raised")
      `,
      "libromancer-mystigirl-summon-success.lua",
    );
    expect(summonSuccess.ok, summonSuccess.error).toBe(true);
    expect(host.messages).toContain("libromancer mystigirl summon success raised");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      eventTriggerTiming: trigger.eventTriggerTiming,
    }))).toEqual([
      {
        sourceUid: mystigirl.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: mystigirl.uid,
        eventTriggerTiming: "if",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === mystigirl.uid);
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
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: 0 },
      { code: 2, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: 131072 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

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
