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
const rcielaCode = "16240772";
const spellcasterCode = "162407720";
const destroyedTargetCode = "162407721";
const survivingTargetCode = "162407722";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRcielaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rcielaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasRcielaScript)("Lua real script Rciela target immune delayed destroy", () => {
  it("restores target immunity, delayed Standby GY send, opponent ATK reduction, and zero-ATK destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rcielaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOGRAVE+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("return c:IsFaceup() and c:IsLevelAbove(7) and c:IsRace(RACE_SPELLCASTER)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,g,1,tp,0)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,nil,1,1-tp,LOCATION_MZONE)");
    expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("aux.DelayedOperation(tc,PHASE_STANDBY,id,e,tp,function(ag) Duel.SendtoGrave(ag,REASON_EFFECT) end");
    expect(script).toContain("local resetcount=Duel.GetCurrentPhase()<=PHASE_STANDBY and 2 or 1");
    expect(script).toContain("function() return Duel.GetTurnCount()~=prevturn end");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 16240772, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rcielaCode, spellcasterCode] }, 1: { main: [destroyedTargetCode, survivingTargetCode] } });
    startDuel(session);
    const rciela = requireCard(session, rcielaCode);
    const spellcaster = requireCard(session, spellcasterCode);
    const destroyedTarget = requireCard(session, destroyedTargetCode, 1);
    const survivingTarget = requireCard(session, survivingTargetCode, 1);
    moveDuelCard(session.state, rciela.uid, "hand", 0);
    moveFaceUpAttack(session, spellcaster, 0);
    moveFaceUpAttack(session, destroyedTarget, 1);
    moveFaceUpAttack(session, survivingTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rcielaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === rciela.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);

    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === rciela.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === spellcaster.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === destroyedTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: rciela.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === survivingTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === survivingTarget.uid), restored.session.state)).toBe(400);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === spellcaster.uid && [1, 100].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 1, range: ["monsterZone"], reset: { flags: 1107169792 }, value: undefined },
    ]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === survivingTarget.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 33427456 }, value: -1600 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "breakEffect", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      eventChainLinkId: event.eventChainLinkId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spellcaster.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, eventChainLinkId: "chain-2", previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rciela.uid, eventReasonEffectId: 1, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rciela.uid, eventReasonEffectId: 1, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: rciela.uid, eventReasonEffectId: 1, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: destroyedTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: rciela.uid, eventReasonEffectId: 1, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: rciela.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, eventChainLinkId: "chain-2", previousLocation: undefined, currentLocation: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rcielaCode, name: "Sinful Spoils of Doom - Rciela", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: spellcasterCode, name: "Rciela Spellcaster Target", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, level: 7, attack: 1600, defense: 1600 },
    { code: destroyedTargetCode, name: "Rciela Zeroed Opponent", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
    { code: survivingTargetCode, name: "Rciela Surviving Opponent", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, owner?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (owner === undefined || candidate.owner === owner));
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
