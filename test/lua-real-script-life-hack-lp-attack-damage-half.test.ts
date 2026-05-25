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
const lifeHackCode = "83589191";
const attackerCode = "835891910";
const graveTargetCode = "835891911";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLifeHackScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lifeHackCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const attributeLight = 0x10;
const effectSetAttackFinal = 102;
const effectChangeDamage = 82;

describe.skipIf(!hasUpstreamScripts || !hasLifeHackScript)("Lua real script Life Hack LP attack damage half", () => {
  it("restores hand activation into opponent-LP final ATK and halved battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lifeHackCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createLifeHackSession(reader, workspace, [lifeHackCode, attackerCode]);
    const lifeHack = requireCard(session, lifeHackCode);
    const attacker = requireCard(session, attackerCode);

    moveDuelCard(session.state, lifeHack.uid, "hand", 0);
    moveFaceUpAttack(session, attacker, 0, 0);
    session.state.players[1].lifePoints = 6000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === lifeHack.uid
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, lifeHack.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(currentAttack(findCard(restoredOpen.session, attacker.uid), restoredOpen.session.state)).toBe(6000);
    expect(restoredOpen.session.state.effects.filter((effect) => [effectSetAttackFinal, effectChangeDamage].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
      valueKind: effect.battleDamageValue === undefined ? undefined : "battleDamageValue",
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: undefined, reset: { flags: 1107169792 }, sourceUid: attacker.uid, targetRange: undefined, value: 6000, valueKind: undefined },
      { code: effectChangeDamage, event: "continuous", property: 0x4000800, reset: { flags: 0x40000200 }, sourceUid: lifeHack.uid, targetRange: [0, 1], value: undefined, valueKind: "battleDamageValue" },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    applyRestoredActionAndAssert(restoredBattle, requireAction(restoredBattle, 0, (action) => action.type === "changePhase" && action.phase === "battle"));
    const directAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.directAttack
    );
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, directAttack!);
    passRestoredBattle(restoredBattle);

    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 3000 });
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(3000);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: 1143, eventName: "battleDamageDealt", eventPlayer: 1, eventReason: duelReason.battle, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventValue: 3000 },
    ]);
  });

  it("restores grave SelfBanish ignition into own-LP final ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards());
    const session = createLifeHackSession(reader, workspace, [lifeHackCode, graveTargetCode]);
    const lifeHack = requireCard(session, lifeHackCode);
    const target = requireCard(session, graveTargetCode);

    moveDuelCard(session.state, lifeHack.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, target, 0, 0);
    session.state.players[0].lifePoints = 5000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === lifeHack.uid
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, lifeHack.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: lifeHack.uid,
    });
    expect(currentAttack(findCard(restoredOpen.session, target.uid), restoredOpen.session.state)).toBe(5000);
    expect(restoredOpen.session.state.effects.filter((effect) => [effectSetAttackFinal, effectChangeDamage].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
      valueKind: effect.battleDamageValue === undefined ? undefined : "battleDamageValue",
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, value: 5000, valueKind: undefined },
      { code: effectChangeDamage, event: "continuous", property: 0x4000800, reset: { flags: 0x40000200 }, sourceUid: lifeHack.uid, targetRange: [0, 1], value: undefined, valueKind: "battleDamageValue" },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(findCard(restoredResolved.session, target.uid), restoredResolved.session.state)).toBe(5000);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Life Hack");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetLabel(1)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("e2:SetLabel(2)");
  expect(script).toContain("local p=e:GetLabel()==1 and 1-tp or tp");
  expect(script).toContain("local lp=Duel.GetLP(p)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,lp)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(Duel.GetLP(p))");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_DAMAGE)");
  expect(script).toContain("e2:SetValue(function(e,re,val,r,rp,rc) return val//2 end)");
}

function cards(): DuelCardData[] {
  return [
    { code: lifeHackCode, name: "Life Hack", kind: "spell", typeFlags: typeSpell },
    { code: attackerCode, name: "Life Hack Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1800, defense: 1200 },
    { code: graveTargetCode, name: "Life Hack Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
  ];
}

function createLifeHackSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  main: string[],
): DuelSession {
  const session = createDuel({ seed: 83589191, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: [] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lifeHackCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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

function requireAction(
  restored: ReturnType<typeof restoreDuelWithLuaScripts>,
  player: PlayerId,
  predicate: (action: DuelAction) => boolean,
): DuelAction {
  const action = getLuaRestoreLegalActions(restored, player).find(predicate);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.currentAttack || restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage" || action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
