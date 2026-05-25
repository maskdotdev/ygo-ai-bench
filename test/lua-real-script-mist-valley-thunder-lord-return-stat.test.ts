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
const thunderLordCode = "89310929";
const returnTargetCode = "893109290";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasThunderLordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${thunderLordCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceThunder = 0x1000;
const attributeWind = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasThunderLordScript)("Lua real script Mist Valley Thunder Lord return stat", () => {
  it("restores quick target return to hand into self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${thunderLordCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 89310929, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [returnTargetCode], extra: [thunderLordCode] }, 1: { main: [] } });
    startDuel(session);

    const thunderLord = requireCard(session, thunderLordCode);
    const returnTarget = requireCard(session, returnTargetCode);
    moveFaceUpAttack(session, thunderLord, 0, 0);
    moveFaceUpAttack(session, returnTarget, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thunderLordCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === thunderLord.uid && candidate.effectId === "lua-3-1002"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    passRestoredChain(restored);

    expect(findCard(restored.session, returnTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: thunderLord.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(findCard(restored.session, thunderLord.uid), restored.session.state)).toBe(3100);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === thunderLord.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: thunderLord.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: returnTarget.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 3 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: returnTarget.uid, eventReason: duelReason.effect, eventReasonCardUid: thunderLord.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const thunderLord = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === thunderLordCode);
  expect(thunderLord).toBeDefined();
  return [
    thunderLord!,
    { code: returnTargetCode, name: "Mist Valley Return Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeWind, level: 4, attack: 1400, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mist Valley Thunder Lord");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsSetCard,SET_MIST_VALLEY),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,LOCATION_ONFIELD,0,1,1,c)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
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
