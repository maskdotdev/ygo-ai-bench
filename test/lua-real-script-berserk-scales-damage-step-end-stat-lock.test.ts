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
const berserkCode = "52497105";
const targetCode = "524971050";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasScalesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${berserkCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const effectCannotDirectAttack = 73;
const effectUpdateAttack = 100;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasScalesScript)("Lua real script Berserk Scales damage step end stat lock", () => {
  it("restores target ATK boost, direct-attack lock, and End Phase net ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${berserkCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 52497105, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [berserkCode, targetCode] }, 1: { main: [] } });
    startDuel(session);
    const scales = requireCard(session, berserkCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, scales.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(berserkCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === scales.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === scales.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2500);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [effectCannotDirectAttack, effectUpdateAttack, phaseEndEventCode].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, description: undefined, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, triggerEvent: undefined, value: 1000 },
      { code: effectCannotDirectAttack, description: 3207, event: "continuous", property: 0x4000000, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, triggerEvent: undefined, value: undefined },
      { code: phaseEndEventCode, description: undefined, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, triggerEvent: undefined, value: undefined },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: scales.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);

    expectRestoredLegalActions(restoredOpen, 0);
    const main2 = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, main2!);
    const end = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, end!);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(500);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([
      { eventName: "phaseEnd", eventCode: phaseEndEventCode },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const scales = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === berserkCode);
  expect(scales).toBeDefined();
  return [
    scales!,
    { code: targetCode, name: "Berserk Scales Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Berserk Scales");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("EFFECT_FLAG_DAMAGE_STEP");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.GetCurrentPhase()~=PHASE_DAMAGE");
  expect(script).toContain("c~=Duel.GetAttacker()");
  expect(script).toContain("Duel.GetAttackTarget()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("EFFECT_FLAG_CLIENT_HINT");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e3:SetOperation(s.atkdown)");
  expect(script).toContain("e1:SetValue(-1000)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
