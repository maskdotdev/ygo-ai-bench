import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const frauleinCode = "6039967";
const zombieAttackerCode = "60399670";
const battleTargetCode = "60399671";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFrauleinScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${frauleinCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const promptOverrides = [{ api: "AnnounceNumber" as const, player: 0 as const, returned: 1000 }];

describe.skipIf(!hasUpstreamScripts || !hasFrauleinScript)("Lua real script Vampire Fraulein attack summon LP stat revive", () => {
  it("restores attack-announce hand summon, LP-cost pre-damage Zombie boost, and Battle Phase revive of destroyed monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${frauleinCode}.lua`);
    expectFrauleinScriptShape(script);
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredFrauleinField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const fraulein = requireCard(restoredOpen.session, frauleinCode);
    const attacker = requireCard(restoredOpen.session, zombieAttackerCode);
    const target = requireCard(restoredOpen.session, battleTargetCode);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);

    const restoredHandTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredHandTrigger);
    expectRestoredLegalActions(restoredHandTrigger, 0);
    const handSummon = getLuaRestoreLegalActions(restoredHandTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fraulein.uid && action.effectId === "lua-1-1130"
    );
    expect(handSummon, JSON.stringify(getLuaRestoreLegalActions(restoredHandTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHandTrigger, handSummon!);
    resolveRestoredChain(restoredHandTrigger);
    expect(restoredHandTrigger.session.state.cards.find((card) => card.uid === fraulein.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fraulein.uid,
      reasonEffectId: 1,
    });

    const restoredPreDamage = createRestoredFrauleinBattleField({ reader, workspace });
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const battleFraulein = requireCard(restoredPreDamage.session, frauleinCode);
    const battleTarget = requireCard(restoredPreDamage.session, battleTargetCode);
    const frauleinAttack = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleFraulein.uid && action.targetUid === battleTarget.uid
    );
    expect(frauleinAttack, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, frauleinAttack!);
    passUntilBattleWindow(restoredPreDamage, "beforeDamageCalculation");
    passUntilRestoredAction(restoredPreDamage, 0, battleFraulein.uid);
    const boost = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) =>
      action.type === "activateEffect" && action.uid === battleFraulein.uid && action.effectId === "lua-2-1134"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, boost!);
    resolveRestoredChain(restoredPreDamage);
    expect(restoredPreDamage.host.promptDecisions.map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      options: "options" in prompt ? prompt.options : undefined,
      returned: "returned" in prompt ? prompt.returned : undefined,
    }))).toEqual([{ api: "AnnounceNumber", player: 0, options: Array.from({ length: 30 }, (_, index) => (index + 1) * 100), returned: 1000 }]);
    expect(restoredPreDamage.session.state.players[0].lifePoints).toBe(7000);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === battleFraulein.uid), restoredPreDamage.session.state)).toBe(1600);
    expect(currentDefense(restoredPreDamage.session.state.cards.find((card) => card.uid === battleFraulein.uid), restoredPreDamage.session.state)).toBe(3000);
    expect(restoredPreDamage.session.state.effects.filter((effect) =>
      effect.sourceUid === battleFraulein.uid && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? 0)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 0x40000040 }, sourceUid: battleFraulein.uid, value: 1000 },
      { code: effectUpdateDefense, event: "continuous", reset: { flags: 0x40000040 }, sourceUid: battleFraulein.uid, value: 1000 },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredBattle);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 600 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: battleFraulein.uid,
    });
    expect(restoredBattle.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "card", ownerId: battleFraulein.uid, code: Number(frauleinCode) + 1, value: 0 }),
    ]);

    const restoredEndBattle = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredEndBattle);
    expectRestoredLegalActions(restoredEndBattle, 0);
    const main2 = getLuaRestoreLegalActions(restoredEndBattle, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredEndBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndBattle, main2!);

    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(restoredEndBattle.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const revive = getLuaRestoreLegalActions(restoredRevive, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === battleFraulein.uid && action.effectId === "lua-4-4224"
    );
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, revive!);
    resolveRestoredChain(restoredRevive);
    expect(restoredRevive.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: battleFraulein.uid,
      reasonEffectId: 4,
    });
    expect(restoredRevive.session.state.eventHistory.filter((event) => ["battleDestroyed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: battleTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: battleFraulein.uid, eventReasonEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: battleTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: battleFraulein.uid, eventReasonEffectId: 4 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: frauleinCode, name: "Vampire Fraulein", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 5, attack: 600, defense: 2000 },
    { code: zombieAttackerCode, name: "Fraulein Zombie Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 2000, defense: 1200 },
    { code: battleTargetCode, name: "Fraulein Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredFrauleinField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 6039967, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [frauleinCode, zombieAttackerCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, frauleinCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, zombieAttackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(frauleinCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function createRestoredFrauleinBattleField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 6039968, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [frauleinCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, frauleinCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(frauleinCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function expectFrauleinScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Vampire Fraulein");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("Duel.CheckLPCost(tp,100)");
  expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(t))");
  expect(script).toContain("Duel.PayLPCost(tp,ac)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("RegisterFlagEffect(id+1,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_BATTLE,0,1)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.NecroValleyFilter(s.spfilter2),tp,LOCATION_GRAVE,LOCATION_GRAVE,nil,e,tp,e:GetHandler(),Duel.GetTurnCount())");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function passUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passUntilRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === uid)) {
    expect(++guard).toBeLessThan(10);
    const responsePlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, responsePlayer).find((action) => action.type === "passDamage" || action.type === "passAttack");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, responsePlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.chain.length > 0 ? "passChain" : restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
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
