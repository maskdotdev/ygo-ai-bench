import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const neoCipherCode = "12632096";
const materialCode = "126320960";
const targetCode = "126320961";
const otherAttackerCode = "126320962";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNeoCipherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${neoCipherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setCipher = 0xe5;
const categoryControl = 0x2000;
const effectDisable = 2;
const effectDisableEffect = 8;
const effectCannotDirectAttack = 73;
const effectSetAttackFinal = 102;
const effectChangeCode = 114;
const effectFlagCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasNeoCipherScript)("Lua real script Neo Galaxy-Eyes Cipher Dragon detach group control stat code", () => {
  it("restores variable detach count into operated-group control, negate, final ATK, code change, and direct-attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${neoCipherCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 12632096, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, otherAttackerCode], extra: [neoCipherCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const neoCipher = requireCard(session, neoCipherCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    const otherAttacker = requireCard(session, otherAttackerCode);
    moveFaceUpAttack(session, neoCipher, 0, 0);
    neoCipher.summonType = "xyz";
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
    neoCipher.overlayUids.push(material.uid);
    moveFaceUpAttack(session, otherAttacker, 0, 1);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(neoCipherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === neoCipher.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", range: ["monsterZone"], sourceUid: neoCipher.uid },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", range: ["monsterZone"], sourceUid: neoCipher.uid },
    ]);

    const action = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === neoCipher.uid && candidate.effectId === "lua-2",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: neoCipher.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === neoCipher.uid)?.overlayUids).toEqual([]);
    const controlledTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid);
    expect(controlledTarget).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: neoCipher.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(controlledTarget, restoredOpen.session.state)).toBe(4500);
    expect(isCardDisabled(restoredOpen.session.state, controlledTarget!, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredOpen.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      (effect.sourceUid === target.uid && [effectDisable, effectDisableEffect, effectSetAttackFinal, effectChangeCode].includes(effect.code ?? -1))
      || (effect.sourceUid === neoCipher.uid && effect.code === effectCannotDirectAttack)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotDirectAttack, event: "continuous", label: undefined, property: undefined, reset: { flags: 1073742336 }, sourceUid: neoCipher.uid, targetRange: [4, 0], value: undefined },
      { code: effectDisable, event: "continuous", label: undefined, property: effectFlagCannotDisable, reset: { flags: 66981888, count: 1 }, sourceUid: target.uid, targetRange: undefined, value: undefined },
      { code: effectDisableEffect, event: "continuous", label: undefined, property: effectFlagCannotDisable, reset: { flags: 66981888, count: 1 }, sourceUid: target.uid, targetRange: undefined, value: 131072 },
      { code: effectSetAttackFinal, event: "continuous", label: undefined, property: effectFlagCannotDisable, reset: { flags: 66981888 }, sourceUid: target.uid, targetRange: undefined, value: 4500 },
      { code: effectChangeCode, event: "continuous", label: undefined, property: effectFlagCannotDisable, reset: { flags: 66981888 }, sourceUid: target.uid, targetRange: undefined, value: Number(neoCipherCode) },
    ]);
    expect(getLegalActions(restoredOpen.session, 0).some((legal) =>
      legal.type === "declareAttack" && legal.attackerUid === otherAttacker.uid && legal.directAttack,
    )).toBe(false);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: neoCipher.uid, eventReasonEffectId: 2, previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: neoCipher.uid, eventReasonEffectId: 2, previousController: 1, currentController: 0 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === target.uid), restoredAfter.session.state)).toBe(4500);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Neo Galaxy-Eyes Cipher Dragon");
  expect(script).toContain("Xyz.AddProcedure(c,nil,9,3)");
  expect(script).toContain("e:GetHandler():GetOverlayGroup():IsExists(Card.IsSetCard,1,nil,SET_CIPHER)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,s.ctcostmax,function(e,og) e:SetLabel(#og) end))");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsAbleToChangeControler),tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE,tp,LOCATION_REASON_CONTROL)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsAbleToChangeControler),tp,0,LOCATION_MZONE,ct,ct,nil)");
  expect(script).toContain("Duel.GetControl(g,tp,PHASE_END,1)");
  expect(script).toContain("Duel.GetOperatedGroup()");
  expect(script).toContain("tc:NegateEffects(c,RESET_CONTROL)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_CODE)");
}

function cards(): DuelCardData[] {
  return [
    { code: neoCipherCode, name: "Neo Galaxy-Eyes Cipher Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeLight, level: 9, attack: 4500, defense: 3000 },
    { code: materialCode, name: "Neo Cipher Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 9, attack: 1800, defense: 1000, setcodes: [setCipher] },
    { code: targetCode, name: "Neo Cipher Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1900, defense: 1200 },
    { code: otherAttackerCode, name: "Neo Cipher Other Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
