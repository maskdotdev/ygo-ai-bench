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
const gibrineCode = "5530780";
const materialCode = "55307800";
const ownXyzCode = "55307801";
const ownEffectCode = "55307802";
const opponentXyzCode = "55307803";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGibrineScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gibrineCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setExosister = 0x174;

describe.skipIf(!hasUpstreamScripts || !hasGibrineScript)("Lua real script Exosister Gibrine detach Xyz attack", () => {
  it("restores detach-cost ignition into client-hinted own Xyz ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gibrineCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,4,2)");
    expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e2:SetCondition(function(e) return e:GetHandler():HasFlagEffect(id) end)");
    expect(script).toContain("e2:SetCost(Cost.HintSelectedEffect)");
    expect(script).toContain("e3:SetCost(Cost.AND(Cost.DetachFromSelf(1),Cost.HintSelectedEffect))");
    expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,3))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsType,TYPE_XYZ))");
    expect(script).toContain("e1:SetValue(800)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 5530780, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, ownEffectCode], extra: [gibrineCode, ownXyzCode] }, 1: { main: [], extra: [opponentXyzCode] } });
    startDuel(session);

    const gibrine = requireCard(session, gibrineCode);
    const material = requireCard(session, materialCode);
    const ownXyz = requireCard(session, ownXyzCode);
    const ownEffect = requireCard(session, ownEffectCode);
    const opponentXyz = requireCard(session, opponentXyzCode);
    moveFaceUpAttack(session, gibrine, 0);
    gibrine.summonType = "xyz";
    moveDuelCard(session.state, material.uid, "overlay", 0);
    gibrine.overlayUids.push(material.uid);
    moveFaceUpAttack(session, ownXyz, 0);
    ownXyz.summonType = "xyz";
    moveFaceUpAttack(session, ownEffect, 0);
    moveFaceUpAttack(session, opponentXyz, 1);
    opponentXyz.summonType = "xyz";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gibrineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === gibrine.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);

    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: gibrine.uid,
      reasonEffectId: 5,
    });
    expect(restored.session.state.cards.find((card) => card.uid === gibrine.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === gibrine.uid), restored.session.state)).toBe(2200);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === ownXyz.uid), restored.session.state)).toBe(2600);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === ownEffect.uid), restored.session.state)).toBe(1200);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === opponentXyz.uid), restored.session.state)).toBe(2400);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gibrine.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1073742336 }, targetRange: [4, 0], value: 800 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial" && event.eventCardUid === material.uid)).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: gibrine.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gibrineCode, name: "Exosister Gibrine", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setExosister], level: 4, attack: 1400, defense: 2800 },
    { code: materialCode, name: "Exosister Gibrine Material", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setExosister], level: 4, attack: 1000, defense: 1000 },
    { code: ownXyzCode, name: "Exosister Gibrine Own Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: 1800, defense: 1000 },
    { code: ownEffectCode, name: "Exosister Gibrine Non-Xyz Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
    { code: opponentXyzCode, name: "Exosister Gibrine Opponent Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: 2400, defense: 1000 },
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
