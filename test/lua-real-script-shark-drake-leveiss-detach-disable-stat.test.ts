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
const leveissCode = "7628844";
const materialCode = "76288440";
const targetCode = "76288441";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLeveissScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leveissCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasLeveissScript)("Lua real script Shark Drake LeVeiss detach disable stat", () => {
  it("restores Xyz detach cost into target negation AdjustInstantly and final ATK/DEF zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${leveissCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,5,4,s.altmatfilter,aux.Stringid(id,0),4,s.xyzop)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(function() return not (Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()) end)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,tc,1,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,tp,-tc:GetAttack())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DEFCHANGE,tc,1,tp,-tc:GetDefense())");
    expect(script).toContain("tc:NegateEffects(c)");
    expect(script).toContain("Duel.AdjustInstantly(tc)");
    expect(script).toContain("if not tc:IsDisabled() then return end");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_EXTRA_ATTACK)");
    expect(script).toContain("e3:SetCode(EFFECT_PIERCE)");

    const cards: DuelCardData[] = [
      { code: leveissCode, name: "Number C32: Shark Drake LeVeiss", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 5, attack: 3100, defense: 2600 },
      { code: materialCode, name: "LeVeiss Overlay Material", kind: "monster", typeFlags: typeMonster, level: 5, attack: 1000, defense: 1000 },
      { code: targetCode, name: "LeVeiss Negatable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7628844, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [leveissCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const leveiss = requireCard(session, leveissCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, leveiss, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    leveiss.overlayUids.push(material.uid);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leveissCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === leveiss.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", range: ["monsterZone"], value: undefined },
      { code: 1002, event: "quick", range: ["monsterZone"], value: undefined },
      { code: 194, event: "continuous", range: ["monsterZone"], value: 1 },
      { code: 203, event: "continuous", range: ["monsterZone"], value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === leveiss.uid && action.effectId === "lua-2-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredLeveiss = restoredOpen.session.state.cards.find((card) => card.uid === leveiss.uid);
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid);
    expect(restoredLeveiss).toMatchObject({ location: "monsterZone", controller: 0, overlayUids: [] });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(currentAttack(restoredTarget, restoredOpen.session.state)).toBe(0);
    expect(currentDefense(restoredTarget, restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.effects.some((effect) => effect.sourceUid === target.uid && effect.code === 2)).toBe(true);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial")).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: leveiss.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
