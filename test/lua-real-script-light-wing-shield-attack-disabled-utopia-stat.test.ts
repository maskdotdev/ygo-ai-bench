import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const lightWingShieldCode = "83880087";
const negateAttackCode = "14315573";
const utopiaCode = "838800870";
const attackerCode = "838800871";
const attackTargetCode = "838800872";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLightWingShieldScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lightWingShieldCode}.lua`));
const hasNegateAttackScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${negateAttackCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setUtopia = 0x107f;
const effectSetAttackFinal = 102;
const eventAttackDisabled = 1142;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLightWingShieldScript || !hasNegateAttackScript)("Lua real script Light Wing Shield attack disabled Utopia stat", () => {
  it("restores attack-disabled SelectOption target branch into Utopia final ATK doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${lightWingShieldCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 83880087, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [lightWingShieldCode, attackerCode], extra: [utopiaCode] },
      1: { main: [negateAttackCode, attackTargetCode] },
    });
    startDuel(session);

    const shield = requireCard(session, lightWingShieldCode);
    const negateAttack = requireCard(session, negateAttackCode);
    const utopia = requireCard(session, utopiaCode);
    const attacker = requireCard(session, attackerCode);
    const attackTarget = requireCard(session, attackTargetCode);
    moveDuelCard(session.state, shield.uid, "hand", 0);
    moveFaceUpAttack(session, utopia, 0, 0);
    moveFaceUpAttack(session, attacker, 0, 1);
    moveFaceDownSpellTrap(session, negateAttack, 1);
    moveFaceUpAttack(session, attackTarget, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }] });
    expect(host.loadCardScript(Number(lightWingShieldCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(negateAttackCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }] });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === attackTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passAttackIfNeeded(restoredOpen, 0);

    const negate = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === negateAttack.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, negate!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: eventAttackDisabled, eventName: "attackDisabled", eventReason: duelReason.effect, eventReasonCardUid: negateAttack.uid, eventReasonEffectId: 3, eventReasonPlayer: 1 },
    ]);

    const restoredDisabled = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }] });
    expectCleanRestore(restoredDisabled);
    expectRestoredLegalActions(restoredDisabled, 0);
    const beforeShieldHistoryLength = restoredDisabled.session.state.eventHistory.length;
    const shieldAction = getLuaRestoreLegalActions(restoredDisabled, 0).find((action) =>
      action.type === "activateEffect" && action.uid === shield.uid && action.effectId === "lua-1-1142"
    );
    expect(shieldAction, JSON.stringify(getLuaRestoreLegalActions(restoredDisabled, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisabled, shieldAction!);
    resolveRestoredChain(restoredDisabled);

    expect(restoredDisabled.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectOption", player: 0, returned: 1 }]);
    expect(restoredDisabled.session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredDisabled.session.state.cards.find((card) => card.uid === utopia.uid), restoredDisabled.session.state)).toBe(5000);
    expect(restoredDisabled.session.state.effects.filter((effect) => effect.sourceUid === utopia.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: utopia.uid, value: 5000 },
    ]);
    expect(restoredDisabled.session.state.eventHistory.slice(beforeShieldHistoryLength).filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: utopia.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: shield.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredDisabled.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const shield = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === lightWingShieldCode);
  const negateAttack = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === negateAttackCode);
  expect(shield).toBeDefined();
  expect(negateAttack).toBeDefined();
  return [
    shield!,
    negateAttack!,
    { code: utopiaCode, name: "Light Wing Shield Utopia", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setUtopia], race: raceWarrior, attribute: attributeLight, level: 4, attack: 2500, defense: 2000 },
    { code: attackerCode, name: "Light Wing Shield Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: attackTargetCode, name: "Light Wing Shield Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Light Wing Shield");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_DISABLED)");
  expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SkipPhase(turnp,PHASE_BATTLE,RESET_PHASE|PHASE_END,1,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BP)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetBaseAttack()*2)");
  expect(script).toContain("e2:SetCode(EFFECT_OVERLAY_REMOVE_REPLACE)");
  expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_COST)");
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

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.position = "faceDown";
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

function passAttackIfNeeded(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  if (restored.session.state.waitingFor !== player) return;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack");
  if (!pass) return;
  applyRestoredActionAndAssert(restored, pass);
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
