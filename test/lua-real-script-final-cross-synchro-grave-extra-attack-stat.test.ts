import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { registerDuelFlagEffect } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const finalCrossCode = "35756798";
const targetCode = "44508094";
const graveSynchroCode = "60800381";
const flagSynchroCode = "357567982";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFinalCrossScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${finalCrossCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const effectExtraAttack = 194;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFinalCrossScript)("Lua real script Final Cross Synchro grave extra attack stat", () => {
  it("restores Synchro-to-Grave flag gating into extra attack and optional grave-Synchro ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${finalCrossCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 35756798, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [finalCrossCode], extra: [targetCode, graveSynchroCode, flagSynchroCode] }, 1: { main: [] } });
    startDuel(session);
    const finalCross = requireCard(session, finalCrossCode);
    const target = requireCard(session, targetCode);
    const graveSynchro = requireCard(session, graveSynchroCode);
    const flagSynchro = requireCard(session, flagSynchroCode);
    const placedFinalCross = moveDuelCard(session.state, finalCross.uid, "spellTrapZone", 0);
    placedFinalCross.faceUp = false;
    placedFinalCross.position = "faceDown";
    placedFinalCross.turnId = 0;
    moveFaceUpAttack(session, target, 0, 0);
    moveDuelCard(session.state, graveSynchro.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, flagSynchro, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expect(host.loadCardScript(Number(finalCrossCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    destroyDuelCard(restoredOpen.session.state, flagSynchro.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard"].includes(event.eventName) && event.eventCardUid === flagSynchro.uid).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: flagSynchro.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1 },
      { eventCardUid: flagSynchro.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1 },
    ]);
    restoredOpen.session.state.waitingFor = 0;
    const flagProbe = restoredOpen.host.loadScript(
      `
      Debug.Message("final cross flag " .. Duel.GetFlagEffect(0,${finalCrossCode}))
      `,
      "final-cross-flag-probe.lua",
    );
    expect(flagProbe.ok, flagProbe.error).toBe(true);
    expect(restoredOpen.host.messages).toContain("final cross flag 0");
    registerDuelFlagEffect(restoredOpen.session.state, { ownerType: "player", ownerId: 0 }, Number(finalCrossCode), 0x40000200, 0, 1);
    const restoredFlagged = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredFlagged);
    expectRestoredLegalActions(restoredFlagged, 0);
    const activate = getLuaRestoreLegalActions(restoredFlagged, 0).find((action) =>
      action.type === "activateEffect" && action.uid === finalCross.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredFlagged, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlagged, activate!);
    resolveRestoredChain(restoredFlagged);

    expect(findCard(restoredFlagged.session, finalCross.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(findCard(restoredFlagged.session, target.uid)).toMatchObject({ attackModifier: 2300 });
    expect(currentAttack(findCard(restoredFlagged.session, target.uid), restoredFlagged.session.state)).toBe(4800);
    expect(restoredFlagged.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(restoredFlagged.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && [effectExtraAttack, effectUpdateAttack].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectExtraAttack, description: 3201, property: 0x4000400, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1 }]);
    expect(restoredFlagged.session.state.eventHistory.filter((event) => ["becameTarget", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredFlagged.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const databaseCards = workspace.readDatabaseCards("cards.cdb");
  const finalCross = databaseCards.find((card) => card.code === finalCrossCode);
  const target = databaseCards.find((card) => card.code === targetCode);
  const graveSynchro = databaseCards.find((card) => card.code === graveSynchroCode);
  expect(finalCross).toBeDefined();
  expect(target).toBeDefined();
  expect(graveSynchro).toBeDefined();
  return [
    finalCross!,
    target!,
    graveSynchro!,
    { code: flagSynchroCode, name: "Final Cross Flag Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 5, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Final Cross");
  expect(script).toContain("EFFECT_COUNT_CODE_OATH");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.RegisterFlagEffect(tc:GetControler(),id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.GetFlagEffect(tp,id)>0");
  expect(script).toContain("Duel.IsAbleToEnterBP() or Duel.IsBattlePhase()");
  expect(script).toContain("c:IsFaceup() and c:IsType(TYPE_SYNCHRO) and c:CanAttack()");
  expect(script).toContain("not c:IsHasEffect(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("EFFECT_EXTRA_ATTACK");
  expect(script).toContain("EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.HintSelection(atkc,true)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("tc:UpdateAttack(atkc:GetAttack(),RESET_EVENT|RESETS_STANDARD,c)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
