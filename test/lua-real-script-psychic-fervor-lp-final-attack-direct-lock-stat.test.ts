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
const fervorCode = "26773909";
const targetCode = "267739090";
const directAttackerCode = "267739091";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFervorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fervorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePsychic = 0x800;
const attributeEarth = 0x1;
const effectCannotDirectAttack = 73;
const effectSetAttackFinal = 102;
const eventAttackAnnounce = 1130;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFervorScript)("Lua real script Psychic Fervor LP final attack direct lock stat", () => {
  it("restores direct-attack flag and LP filter into LP payment, final ATK doubling, and direct-attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${fervorCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 26773909, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fervorCode, targetCode, directAttackerCode] }, 1: { main: [] } });
    startDuel(session);
    const fervor = requireCard(session, fervorCode);
    const target = requireCard(session, targetCode);
    const directAttacker = requireCard(session, directAttackerCode);
    moveDuelCard(session.state, fervor.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, directAttacker, 0, 1);
    session.state.players[0].lifePoints = 5000;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fervorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const directAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === directAttacker.uid && action.targetUid === undefined
    );
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, directAttack!);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared")).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: eventAttackAnnounce,
        eventCardUid: directAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    passAttackIfNeeded(restoredOpen, 1);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const activate = getLuaRestoreLegalActions(restoredAttack, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fervor.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, activate!);
    resolveRestoredChain(restoredAttack);

    expect(restoredAttack.session.state.players[0].lifePoints).toBe(3000);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === fervor.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === target.uid), restoredAttack.session.state)).toBe(4000);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [effectCannotDirectAttack, effectSetAttackFinal].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, description: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 4000 },
      { code: effectCannotDirectAttack, description: 3207, property: 0x4000000, reset: { flags: 1107169792 }, sourceUid: target.uid, value: undefined },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: fervor.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const fervor = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === fervorCode);
  expect(fervor).toBeDefined();
  return [
    fervor!,
    { code: targetCode, name: "Psychic Fervor Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: directAttackerCode, name: "Psychic Fervor Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 4, attack: 500, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Psychic Fervor");
  expect(script).toContain("EFFECT_COUNT_CODE_OATH");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.GetAttackTarget()==nil");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
  expect(script).toContain("Duel.IsBattlePhase()");
  expect(script).toContain("aux.StatChangeDamageStepCondition()");
  expect(script).toContain("c:GetAttack()<Duel.GetLP(tp)");
  expect(script).toContain("tc:GetFlagEffect(id)==0");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.SetLP(tp,Duel.GetLP(tp)-tc:GetAttack())");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
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

function passAttackIfNeeded(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  if (restored.session.state.waitingFor !== player) return;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
