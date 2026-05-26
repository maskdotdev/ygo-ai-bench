import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const vixenCode = "58712976";
const materialCode = "587129760";
const graveTargetCodes = ["587129761", "587129762", "587129763"] as const;
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasVixenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vixenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePyro = 0x80;
const attributeFire = 0x4;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasVixenScript)("Lua real script Infernal Flame Vixen detach destroyed banish stat", () => {
  it("restores detached ATK gain and destroyed trigger GetChainInfo target banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vixenCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredStat = createRestoredVixenField({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const vixen = requireCard(restoredStat.session, vixenCode);
    const material = requireCard(restoredStat.session, materialCode);
    const graveTargets = graveTargetCodes.map((code) => requireCard(restoredStat.session, code));
    const boost = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === vixen.uid && action.effectId === "lua-2"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, boost!);
    resolveRestoredChain(restoredStat);

    expect(restoredStat.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: vixen.uid,
      reasonEffectId: 2,
    });
    expect(restoredStat.session.state.cards.find((card) => card.uid === vixen.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === vixen.uid), restoredStat.session.state)).toBe(2700);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === vixen.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x2000, reset: { flags: 1107235328, count: 2 }, sourceUid: vixen.uid, value: 500 },
    ]);

    destroyDuelCard(restoredStat.session.state, vixen.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredStat.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventCurrentState: trigger.eventCurrentState,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventPreviousState: trigger.eventPreviousState,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1029",
        eventCardUid: vixen.uid,
        eventCode: 1029,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 4 },
        eventName: "destroyed",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        player: 0,
        sourceUid: vixen.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === vixen.uid && action.effectId === "lua-3-1029"
    );
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyedTrigger!);
    resolveRestoredChain(restoredDestroyed);

    for (const target of graveTargets) {
      expect(restoredDestroyed.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
        location: "banished",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: vixen.uid,
        reasonEffectId: 3,
      });
    }
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === vixen.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: graveTargets[0]!.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: graveTargets[1]!.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: graveTargets[2]!.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredVixenField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 58712976, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [...graveTargetCodes, materialCode], extra: [vixenCode] }, 1: { main: [] } });
  startDuel(session);
  const vixen = moveFaceUpAttack(session, requireCard(session, vixenCode), 0, 0);
  vixen.summonType = "xyz";
  attachOverlayMaterial(session, vixen, requireCard(session, materialCode));
  for (const code of graveTargetCodes) {
    const graveTarget = moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0);
    graveTarget.faceUp = true;
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(vixenCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Infernal Flame Vixen");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_PYRO),4,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e:GetHandler():GetPreviousAttackOnField()>=2500");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,3,3,nil)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.Remove(rg,POS_FACEUP,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const vixen = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === vixenCode);
  expect(vixen).toBeDefined();
  return [
    vixen!,
    ...graveTargetCodes.map((code, index) => ({ code, name: `Infernal Flame Vixen Grave Target ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1200 + index * 100, defense: 1000 })),
    { code: materialCode, name: "Infernal Flame Vixen Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function attachOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance): void {
  const attached = moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller);
  attached.sequence = holder.overlayUids.length;
  holder.overlayUids.push(attached.uid);
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
