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
const volofernigesCode = "38694052";
const materialACode = "386940520";
const materialBCode = "386940521";
const destroyTargetCode = "386940522";
const boostAllyCode = "386940523";
const postLockTargetCode = "386940524";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVolofernigesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${volofernigesCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasVolofernigesScript)("Lua real script Voloferniges detach destroy stat lock", () => {
  it("restores Cost.AND detach target destruction into optional Level-based ATK gain and self attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${volofernigesCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 38694052, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destroyTargetCode, materialACode, materialBCode, boostAllyCode], extra: [volofernigesCode] }, 1: { main: [postLockTargetCode] } });
    startDuel(session);

    const voloferniges = requireCard(session, volofernigesCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    const boostAlly = requireCard(session, boostAllyCode);
    const postLockTarget = requireCard(session, postLockTargetCode, 1);
    moveFaceUpAttack(session, destroyTarget, 0);
    moveFaceUpAttack(session, voloferniges, 0);
    moveDuelCard(session.state, materialA.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    moveDuelCard(session.state, materialB.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    voloferniges.overlayUids.push(materialA.uid, materialB.uid);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(volofernigesCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === voloferniges.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 619104833, returned: true },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: voloferniges.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === materialB.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: voloferniges.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: voloferniges.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === voloferniges.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === voloferniges.uid), restoredOpen.session.state)).toBe(2500 + 2100);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === voloferniges.uid && [85, 100].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 85, description: 3206, event: "continuous", property: 67634176, range: ["monsterZone"], reset: { flags: 1107169792 }, value: undefined },
      { code: 100, description: undefined, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1107169792, count: 2 }, value: 2100 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: voloferniges.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialB.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: voloferniges.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: voloferniges.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: destroyTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: voloferniges.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    moveFaceUpAttack(restoredOpen.session, boostAlly, 0);
    moveFaceUpAttack(restoredOpen.session, postLockTarget, 1);
    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.turnPlayer = 0;
    restoredOpen.session.state.waitingFor = 0;
    const battleProbe = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(battleProbe);
    expectRestoredLegalActions(battleProbe, 0);
    const battleActions = getLuaRestoreLegalActions(battleProbe, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === voloferniges.uid)).toBe(false);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === boostAlly.uid && action.targetUid === postLockTarget.uid)).toBe(true);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,7,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCountLimit(1,0,EFFECT_COUNT_CODE_SINGLE)");
  expect(script).toContain("return not e:GetHandler():GetOverlayGroup():IsExists(Card.IsRace,1,nil,RACE_DRAGON)");
  expect(script).toContain("e1:SetCost(Cost.AND(Cost.DetachFromSelf(2),s.descost))");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil):GetFirst()");
  expect(script).toContain("math.max(tc:GetOriginalLevel(),tc:GetOriginalRank())");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(lvrk*300)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
}

function cards(): DuelCardData[] {
  return [
    { code: volofernigesCode, name: "Voloferniges, the Darkest Dragon Doomrider", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceFiend, attribute: attributeDark, level: 7, attack: 2500, defense: 2100 },
    { code: materialACode, name: "Voloferniges Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 7, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Voloferniges Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 7, attack: 1000, defense: 1000 },
    { code: destroyTargetCode, name: "Voloferniges Level 7 Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 7, attack: 2100, defense: 1000 },
    { code: boostAllyCode, name: "Voloferniges Boost Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: postLockTargetCode, name: "Voloferniges Post-Lock Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
