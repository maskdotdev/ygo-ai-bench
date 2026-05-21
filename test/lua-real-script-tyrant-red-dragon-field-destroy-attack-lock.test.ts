import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tyrantCode = "16172067";
const allyCode = "161720670";
const ownSpellCode = "161720671";
const opponentMonsterCode = "161720672";
const opponentSpellCode = "161720673";
const postLockAllyCode = "161720674";
const postLockTargetCode = "161720675";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTyrantScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tyrantCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeSpell = 0x2;
const raceDragon = 0x2000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasTyrantScript)("Lua real script Tyrant Red Dragon field destroy attack lock", () => {
  it("restores Main Phase field-wide destruction into registered attack lock and client hint", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tyrantCode}.lua`);
    expect(script).toContain("Synchro.AddProcedure(c,nil,2,2,Synchro.NonTuner(nil),1,99)");
    expect(script).toContain("e1:SetCondition(function() return Duel.IsPhase(PHASE_MAIN1) end)");
    expect(script).toContain("Duel.GetMatchingGroup(nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e1:SetTarget(s.ftarget)");
    expect(script).toContain("e1:SetLabel(c:GetFieldID())");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,2),nil)");

    const cards: DuelCardData[] = [
      { code: tyrantCode, name: "Tyrant Red Dragon Archfiend", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, attribute: attributeDark, level: 10, attack: 3500, defense: 3000 },
      { code: allyCode, name: "Tyrant Destroyed Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
      { code: ownSpellCode, name: "Tyrant Own Spell", kind: "spell", typeFlags: typeSpell },
      { code: opponentMonsterCode, name: "Tyrant Destroyed Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: opponentSpellCode, name: "Tyrant Opponent Spell", kind: "spell", typeFlags: typeSpell },
      { code: postLockAllyCode, name: "Tyrant Post-Lock Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 1000 },
      { code: postLockTargetCode, name: "Tyrant Post-Lock Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 16172067, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [allyCode, ownSpellCode, postLockAllyCode], extra: [tyrantCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode, postLockTargetCode] } });
    startDuel(session);

    const tyrant = requireCard(session, tyrantCode);
    const ally = requireCard(session, allyCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const opponentMonster = requireCard(session, opponentMonsterCode, 1);
    const opponentSpell = requireCard(session, opponentSpellCode, 1);
    const postLockAlly = requireCard(session, postLockAllyCode);
    const postLockTarget = requireCard(session, postLockTargetCode, 1);
    moveFaceUpAttack(session, tyrant, 0);
    moveFaceUpAttack(session, ally, 0);
    moveDuelCard(session.state, ownSpell.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, opponentMonster, 1);
    moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tyrantCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === tyrant.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLocked);
    const state = restoredLocked.session.state;
    expect(state.chain).toEqual([]);
    expect(state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(state.cards.find((card) => card.uid === tyrant.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true, position: "faceUpAttack" });
    expect(state.cards.find((card) => card.uid === ally.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: tyrant.uid, reasonEffectId: 4 });
    expect(state.cards.find((card) => card.uid === ownSpell.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: tyrant.uid, reasonEffectId: 4 });
    expect(state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: tyrant.uid, reasonEffectId: 4 });
    expect(state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: tyrant.uid, reasonEffectId: 4 });
    expect(state.eventHistory.filter((event) => event.eventName === "destroyed").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "destroyed", eventCardUid: ownSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: tyrant.uid, eventReasonEffectId: 4 },
      { eventName: "destroyed", eventCardUid: ally.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: tyrant.uid, eventReasonEffectId: 4 },
      { eventName: "destroyed", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: tyrant.uid, eventReasonEffectId: 4 },
      { eventName: "destroyed", eventCardUid: opponentSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: tyrant.uid, eventReasonEffectId: 4 },
      { eventName: "destroyed", eventCardUid: ownSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: tyrant.uid, eventReasonEffectId: 4 },
    ]);
    expect(state.effects.filter((effect) => effect.sourceUid === tyrant.uid && effect.code === 85).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      targetRange: effect.targetRange,
      label: effect.label,
    }))).toEqual([
      { code: 85, event: "continuous", reset: { flags: 1073742336 }, targetRange: [4, 0], label: tyrant.fieldId },
    ]);

    moveFaceUpAttack(restoredLocked.session, postLockAlly, 0);
    moveFaceUpAttack(restoredLocked.session, postLockTarget, 1);
    restoredLocked.session.state.phase = "battle";
    restoredLocked.session.state.turnPlayer = 0;
    restoredLocked.session.state.waitingFor = 0;
    const battleProbe = restoreDuelWithLuaScripts(serializeDuel(restoredLocked.session), workspace, reader);
    expectCleanRestore(battleProbe);
    expectRestoredLegalActions(battleProbe, 0);
    const battleActions = getLuaRestoreLegalActions(battleProbe, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === postLockAlly.uid)).toBe(false);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === tyrant.uid && action.targetUid === postLockTarget.uid)).toBe(true);
  });
});

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
