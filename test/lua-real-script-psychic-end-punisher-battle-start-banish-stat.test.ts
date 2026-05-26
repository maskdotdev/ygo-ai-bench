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
const punisherCode = "60465049";
const opponentTargetCode = "604650490";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPunisherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${punisherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectImmune = 1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPunisherScript)("Lua real script Psychic End Punisher battle start banish stat", () => {
  it("restores LP-gated immunity, Battle Phase Start ATK gain, and SelectUnselectGroup banish cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${punisherCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredBattle = createRestoredPunisherField({ reader, workspace, opponentLp: 8000, ownLp: 6000 });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const punisher = requireCard(restoredBattle.session, punisherCode);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === punisher.uid && effect.code === effectImmune).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      valueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { code: effectImmune, property: 0x20000, range: ["monsterZone"], sourceUid: punisher.uid, valueDescriptor: undefined },
    ]);
    const battle = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battle!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-4104", eventCode: 4104, eventName: "phaseBattle", player: 0, sourceUid: punisher.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === punisher.uid && action.effectId === "lua-5-4104"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === punisher.uid), restoredTrigger.session.state)).toBe(5500);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === punisher.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: punisher.uid, value: 2000 },
    ]);

    const restoredRemove = createRestoredPunisherField({ reader, workspace, opponentLp: 8000, ownLp: 8000, includeOpponentTarget: true });
    expectCleanRestore(restoredRemove);
    expectRestoredLegalActions(restoredRemove, 0);
    const removePunisher = requireCard(restoredRemove.session, punisherCode);
    const opponentTarget = requireCard(restoredRemove.session, opponentTargetCode);
    const remove = getLuaRestoreLegalActions(restoredRemove, 0).find((action) =>
      action.type === "activateEffect" && action.uid === removePunisher.uid && action.effectId === "lua-4"
    );
    expect(remove, JSON.stringify(getLuaRestoreLegalActions(restoredRemove, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemove, remove!);
    resolveRestoredChain(restoredRemove);
    expect(restoredRemove.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredRemove.session.state.cards.find((card) => card.uid === removePunisher.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: removePunisher.uid,
      reasonEffectId: 4,
    });
    expect(restoredRemove.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: removePunisher.uid,
      reasonEffectId: 4,
    });
    expect(restoredRemove.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPunisherField({
  includeOpponentTarget = false,
  opponentLp,
  ownLp,
  reader,
  workspace,
}: {
  includeOpponentTarget?: boolean;
  opponentLp: number;
  ownLp: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: includeOpponentTarget ? 60465050 : 60465049, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { extra: [punisherCode], main: [] }, 1: { main: includeOpponentTarget ? [opponentTargetCode] : [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, punisherCode), 0, 0).summonType = "synchro";
  if (includeOpponentTarget) moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  session.state.players[0].lifePoints = ownLp;
  session.state.players[1].lifePoints = opponentLp;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(punisherCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Psychic End Punisher");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
  expect(script).toContain("EFFECT_FLAG_SINGLE_RANGE");
  expect(script).toContain("Duel.GetLP(tp)<=Duel.GetLP(1-tp) and e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("Cost.PayLP(1000)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.SetTargetCard(rg)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_BATTLE_START)");
  expect(script).toContain("math.abs(Duel.GetLP(tp)-Duel.GetLP(1-tp))");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const punisher = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === punisherCode);
  expect(punisher).toBeDefined();
  return [
    punisher!,
    { code: opponentTargetCode, name: "Psychic End Punisher Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
