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
const cipherCode = "18963306";
const materialCode = "189633060";
const targetCode = "189633061";
const otherAttackerCode = "189633062";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCipherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cipherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const categoryControl = 0x2000;
const effectDisable = 2;
const effectDisableEffect = 8;
const effectCannotDirectAttack = 73;
const effectSetAttackFinal = 102;
const effectChangeCode = 114;

describe.skipIf(!hasUpstreamScripts || !hasCipherScript)("Lua real script Galaxy-Eyes Cipher Dragon detach control stat code", () => {
  it("restores detach control into disable, final ATK, code change, and direct-attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cipherCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 18963306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, otherAttackerCode], extra: [cipherCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const cipher = requireCard(session, cipherCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    const otherAttacker = requireCard(session, otherAttackerCode);
    moveFaceUpAttack(session, cipher, 0, 0);
    cipher.summonType = "xyz";
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
    cipher.overlayUids.push(material.uid);
    moveFaceUpAttack(session, otherAttacker, 0, 1);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cipherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === cipher.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: cipher.uid },
      { category: categoryControl, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], sourceUid: cipher.uid },
    ]);

    const action = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === cipher.uid && candidate.effectId === "lua-2",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: cipher.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cipher.uid)?.overlayUids).toEqual([]);
    const controlledTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid);
    expect(controlledTarget).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: cipher.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(controlledTarget, restoredOpen.session.state)).toBe(3000);
    expect(isCardDisabled(restoredOpen.session.state, controlledTarget!, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredOpen.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      (effect.sourceUid === target.uid && [effectDisable, effectDisableEffect, effectSetAttackFinal, effectChangeCode].includes(effect.code ?? -1))
      || (effect.sourceUid === cipher.uid && effect.code === effectCannotDirectAttack)
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
      { code: effectCannotDirectAttack, event: "continuous", label: cipher.fieldId, property: undefined, reset: { flags: 1073742336 }, sourceUid: cipher.uid, targetRange: [4, 0], value: undefined },
      { code: effectDisable, event: "continuous", label: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, value: undefined },
      { code: effectDisableEffect, event: "continuous", label: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, value: undefined },
      { code: effectSetAttackFinal, event: "continuous", label: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, value: 3000 },
      { code: effectChangeCode, event: "continuous", label: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, value: Number(cipherCode) },
    ]);
    expect(getLegalActions(restoredOpen.session, 0).some((legal) =>
      legal.type === "declareAttack" && legal.attackerUid === otherAttacker.uid && legal.directAttack,
    )).toBe(false);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
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
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: cipher.uid, eventReasonEffectId: 2, previousController: 0, currentController: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 1, currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: cipher.uid, eventReasonEffectId: 2, previousController: 1, currentController: 0 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === target.uid), restoredAfter.session.state)).toBe(3000);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Galaxy-Eyes Cipher Dragon");
  expect(script).toContain("Xyz.AddProcedure(c,nil,8,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("e4:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e5:SetCode(EFFECT_CHANGE_CODE)");
  expect(script).toContain("e:GetHandler():GetCardEffect(EFFECT_SET_CONTROL)");
}

function cards(): DuelCardData[] {
  return [
    { code: cipherCode, name: "Galaxy-Eyes Cipher Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: materialCode, name: "Cipher Dragon Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 1800, defense: 1000 },
    { code: targetCode, name: "Cipher Dragon Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1900, defense: 1200 },
    { code: otherAttackerCode, name: "Cipher Dragon Other Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
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
