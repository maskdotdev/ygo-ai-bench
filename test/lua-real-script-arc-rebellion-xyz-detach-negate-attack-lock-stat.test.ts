import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const arcCode = "64276752";
const detachMaterialCode = "642767520";
const darkXyzMaterialCode = "642767521";
const allyCode = "642767522";
const opponentCode = "642767523";
const trapMonsterCode = "642767524";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasArcScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${arcCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typeTrapMonster = 0x100;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasArcScript)("Lua real script Arc Rebellion Xyz detach negate attack-lock stat", () => {
  it("restores Xyz indestructibility, detach ATK gain, DARK Xyz overlay negation, and other-monster attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${arcCode}.lua`));
    const reader = createCardReader(cards());

    const session = createDuel({ seed: 64276752, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [detachMaterialCode, darkXyzMaterialCode, allyCode], extra: [arcCode] },
      1: { main: [opponentCode, trapMonsterCode] },
    });
    startDuel(session);

    const arc = requireCard(session, arcCode);
    const detachMaterial = requireCard(session, detachMaterialCode);
    const darkXyzMaterial = requireCard(session, darkXyzMaterialCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    const trapMonster = requireCard(session, trapMonsterCode);
    moveFaceUpAttack(session, arc, 0, 0);
    arc.summonType = "xyz";
    arc.summonPlayer = 0;
    moveDuelCard(session.state, detachMaterial.uid, "overlay", 0);
    moveDuelCard(session.state, darkXyzMaterial.uid, "overlay", 0);
    arc.overlayUids.push(detachMaterial.uid, darkXyzMaterial.uid);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    moveFaceUpAttack(session, trapMonster, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(arcCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === arc.uid && effect.code === 41)).toMatchObject({
      code: 41,
      event: "continuous",
      property: 0x20000,
      range: ["monsterZone"],
      sourceUid: arc.uid,
      value: 1,
    });
    const protectedDestroy = destroyDuelCard(restoredOpen.session.state, arc.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(protectedDestroy).toMatchObject({ uid: arc.uid, location: "monsterZone", controller: 0 });

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === arc.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    const state = restoredResolved.session.state;
    expect(state.cards.find((card) => card.uid === detachMaterial.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: arc.uid,
      reasonEffectId: 3,
    });
    expect(state.cards.find((card) => card.uid === arc.uid)?.overlayUids).toEqual([darkXyzMaterial.uid]);
    expect(state.cards.find((card) => card.uid === arc.uid)).toMatchObject({ attackModifier: 4800 });
    expect(currentAttack(state.cards.find((card) => card.uid === arc.uid), state)).toBe(7800);
    expect(isCardDisabled(state, state.cards.find((card) => card.uid === opponent.uid)!, (effect, sourceCard, targetCard) =>
      createEffectContext(state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(isCardDisabled(state, state.cards.find((card) => card.uid === trapMonster.uid)!, (effect, sourceCard, targetCard) =>
      createEffectContext(state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(state.effects.filter((effect) => effect.sourceUid === arc.uid && effect.code === 85).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 85, event: "continuous", property: 0x80, reset: { flags: 1073742336 }, targetRange: [4, 0] },
    ]);
    expect(state.effects.filter((effect) => [opponent.uid, trapMonster.uid].includes(effect.sourceUid ?? "") && [2, 8, 10].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 2, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponent.uid },
      { code: 8, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponent.uid },
      { code: 2, event: "continuous", reset: { flags: 33427456 }, sourceUid: trapMonster.uid },
      { code: 8, event: "continuous", reset: { flags: 33427456 }, sourceUid: trapMonster.uid },
      { code: 10, event: "continuous", reset: { flags: 33427456 }, sourceUid: trapMonster.uid },
    ]);
    expect(state.eventHistory.filter((event) => ["detachedMaterial", "breakEffect"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: detachMaterial.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: arc.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: arc.uid,
        eventReasonEffectId: 3,
      },
    ]);

    restoredResolved.session.state.phase = "battle";
    restoredResolved.session.state.turnPlayer = 0;
    restoredResolved.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredResolved, 0);
    const battleActions = getLuaRestoreLegalActions(restoredResolved, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === ally.uid)).toBe(false);
    const attack = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === arc.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(battleActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResolved, attack!);
    finishRestoredBattle(restoredResolved);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 5800 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,5,3)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_NEGATE)");
  expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("return c:IsFaceup() and c:GetBaseAttack()>0");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_DARK) and c:IsType(TYPE_XYZ)");
  expect(script).toContain("e0:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e0:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("Duel.RegisterEffect(e0,tp)");
  expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,1),nil)");
  expect(script).toContain("local atk=g:GetSum(Card.GetBaseAttack)");
  expect(script).toContain("if c:UpdateAttack(atk)==atk and c:GetOverlayGroup():IsExists(s.ovfilter,1,nil) then");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("local ng=g1:Filter(Card.IsNegatableMonster,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_TRAPMONSTER)");
}

function cards(): DuelCardData[] {
  return [
    { code: arcCode, name: "Arc Rebellion Xyz Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 5, attack: 3000, defense: 2500 },
    { code: detachMaterialCode, name: "Arc Rebellion Detach Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 5, attack: 1000, defense: 1000 },
    { code: darkXyzMaterialCode, name: "Arc Rebellion DARK Xyz Material", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: allyCode, name: "Arc Rebellion Locked Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentCode, name: "Arc Rebellion Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: trapMonsterCode, name: "Arc Rebellion Trap Monster", kind: "monster", typeFlags: typeMonster | typeEffect | typeTrapMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
