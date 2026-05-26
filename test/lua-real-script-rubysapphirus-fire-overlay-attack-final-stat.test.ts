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
const rubysapphirusCode = "6906306";
const fireMaterialCode = "69063060";
const waterMaterialCode = "69063061";
const battleTargetCode = "69063062";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRubysapphirusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rubysapphirusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const attributeFire = 0x4;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasRubysapphirusScript)("Lua real script Rubysapphirus FIRE overlay attack final stat", () => {
  it("restores attack announce trigger into FIRE overlay-gated final ATK doubling and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rubysapphirusCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,9,2,nil,nil,Xyz.InfiniteMats)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("c:GetOverlayGroup():IsExists(Card.IsAttribute,1,nil,ATTRIBUTE_FIRE)");
    expect(script).toContain("local bc=Duel.GetAttackTarget()");
    expect(script).toContain("bc and bc:IsFaceup() and bc:GetAttack()>c:GetAttack()");
    expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 6906306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fireMaterialCode, waterMaterialCode], extra: [rubysapphirusCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const rubysapphirus = requireCard(session, rubysapphirusCode);
    const fireMaterial = requireCard(session, fireMaterialCode);
    const waterMaterial = requireCard(session, waterMaterialCode);
    const target = requireCard(session, battleTargetCode, 1);
    moveFaceUpAttack(session, rubysapphirus, 0, 0);
    for (const [sequence, material] of [fireMaterial, waterMaterial].entries()) {
      moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = sequence;
      rubysapphirus.overlayUids.push(material.uid);
    }
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rubysapphirusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === rubysapphirus.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-3-1130",
        eventCardUid: rubysapphirus.uid,
        eventCode: 1130,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "attackDeclared",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [rubysapphirus.uid, target.uid],
        id: "trigger-3-1",
        player: 0,
        sourceUid: rubysapphirus.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === rubysapphirus.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === rubysapphirus.uid), restoredTrigger.session.state)).toBe(5000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === rubysapphirus.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107169312 }, sourceUid: rubysapphirus.uid, value: 5000 },
    ]);

    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rubysapphirusCode, name: "Rubysapphirus, the Adamant Jewel", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 9, attack: 2500, defense: 2500 },
    { code: fireMaterialCode, name: "Rubysapphirus FIRE Material", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeFire, level: 9, attack: 1000, defense: 1000 },
    { code: waterMaterialCode, name: "Rubysapphirus WATER Material", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 9, attack: 1000, defense: 1000 },
    { code: battleTargetCode, name: "Rubysapphirus Strong Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 9, attack: 3600, defense: 3000 },
  ];
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
