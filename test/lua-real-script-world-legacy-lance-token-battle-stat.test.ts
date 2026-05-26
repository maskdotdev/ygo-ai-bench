import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const lanceCode = "46647144";
const tokenCode = "46647145";
const worldLegacyAllyCode = "466471440";
const offSetTargetCode = "466471441";
const opponentAttackerCode = "466471442";
const linkAttackerCode = "466471443";
const battleDefenderCode = "466471444";
const extraSummonedCode = "466471445";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLanceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lanceCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeToken = 0x4000;
const typeLink = 0x4000000;
const summonTypeLink = 0x4c000000;
const setWorldLegacy = 0xfe;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectCannotSelectBattleTarget = 332;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasLanceScript)("Lua real script World Legacy Lance token battle stat", () => {
  it("restores battle target lock, pre-damage self-discard ATK drop, and Extra Deck summon dual Token trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectLanceScriptShape(workspace.readScript(`official/c${lanceCode}.lua`));
    const reader = createCardReader(cards());

    const restoredTargetLock = createRestoredTargetLock({ reader, workspace });
    expectCleanRestore(restoredTargetLock);
    expectRestoredLegalActions(restoredTargetLock, 1);
    const fieldLance = requireCard(restoredTargetLock.session, lanceCode);
    const worldLegacyAlly = requireCard(restoredTargetLock.session, worldLegacyAllyCode);
    const offSetTarget = requireCard(restoredTargetLock.session, offSetTargetCode);
    const opponentAttacker = requireCard(restoredTargetLock.session, opponentAttackerCode, 1);
    expect(restoredTargetLock.session.state.effects.filter((effect) => effect.sourceUid === fieldLance.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x200000, code: 1134, countLimit: 1, event: "quick", id: "lua-1-1134", property: undefined, range: ["hand"], targetRange: undefined, triggerEvent: "beforeDamageCalculation" },
      { category: undefined, code: effectCannotSelectBattleTarget, countLimit: undefined, event: "continuous", id: "lua-2-332", property: undefined, range: ["monsterZone"], targetRange: [0, 4], triggerEvent: undefined },
      { category: 0x600, code: 1102, countLimit: 1, event: "trigger", id: "lua-3-1102", property: 0x10000, range: ["monsterZone"], targetRange: undefined, triggerEvent: "specialSummoned" },
    ]);
    expect(getLuaRestoreLegalActions(restoredTargetLock, 1).filter((action) =>
      action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid,
    ).map((action) => "targetUid" in action ? action.targetUid : undefined)).toEqual([
      fieldLance.uid,
      offSetTarget.uid,
    ]);
    expect(getLuaRestoreLegalActions(restoredTargetLock, 1).some((action) =>
      action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid && "targetUid" in action && action.targetUid === worldLegacyAlly.uid,
    )).toBe(false);

    const restoredPreDamage = createRestoredPreDamage({ reader, workspace });
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const handLance = requireCard(restoredPreDamage.session, lanceCode);
    const linkAttacker = requireCard(restoredPreDamage.session, linkAttackerCode);
    const battleDefender = requireCard(restoredPreDamage.session, battleDefenderCode, 1);
    const attack = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === linkAttacker.uid && action.targetUid === battleDefender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, attack!);
    passUntilRestoredAction(restoredPreDamage, 0, handLance.uid);
    const attackDrop = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handLance.uid && action.effectId === "lua-1-1134",
    );
    expect(attackDrop, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, attackDrop!);
    resolveRestoredChain(restoredPreDamage);
    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === handLance.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handLance.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === battleDefender.uid), restoredPreDamage.session.state)).toBe(1000);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === battleDefender.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: battleDefender.uid, value: -3000 },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === handLance.uid).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handLance.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: handLance.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
    ]);
    passRestoredBattle(restoredPreDamage);
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });

    const restoredTokenOpen = createRestoredTokenTrigger({ reader, workspace });
    expectCleanRestore(restoredTokenOpen);
    expectRestoredLegalActions(restoredTokenOpen, 0);
    const tokenLance = requireCard(restoredTokenOpen.session, lanceCode);
    const extraSummoned = requireCard(restoredTokenOpen.session, extraSummonedCode);
    specialSummonDuelCard(restoredTokenOpen.session.state, extraSummoned.uid, 0, 0, {}, summonTypeLink, true, true);
    expect(restoredTokenOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: extraSummoned.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: 0, player: 0, sourceUid: tokenLance.uid, triggerBucket: "turnMandatory" },
    ]);
    const restoredTokenTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredTokenOpen.session), workspace, reader);
    expectCleanRestore(restoredTokenTrigger);
    expectRestoredLegalActions(restoredTokenTrigger, 0);
    const tokenSummon = getLuaRestoreLegalActions(restoredTokenTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === tokenLance.uid && action.effectId === "lua-3-1102",
    );
    expect(tokenSummon, JSON.stringify(getLuaRestoreLegalActions(restoredTokenTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTokenTrigger, tokenSummon!);
    expect(restoredTokenTrigger.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredTokenTrigger);
    const tokens = restoredTokenTrigger.session.state.cards.filter((card) => card.code === tokenCode).sort((a, b) => a.controller - b.controller);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", reason: duelReason.summon | duelReason.specialSummon, reasonPlayer: 0, reasonCardUid: tokenLance.uid, reasonEffectId: 3 });
    expect(tokens[1]).toMatchObject({ location: "monsterZone", controller: 1, owner: 0, faceUp: true, position: "faceUpDefense", reason: duelReason.summon | duelReason.specialSummon, reasonPlayer: 0, reasonCardUid: tokenLance.uid, reasonEffectId: 3 });
    expect(restoredTokenTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: extraSummoned.uid, eventUids: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: tokens[0]!.uid, eventUids: [tokens[0]!.uid, tokens[1]!.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: tokenLance.uid, eventReasonEffectId: 3, previous: "hand", current: "monsterZone" },
    ]);
  });
});

function createRestoredTargetLock({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 46647144, reader, workspace, main0: [lanceCode, worldLegacyAllyCode, offSetTargetCode], main1: [opponentAttackerCode], extra0: [] });
  moveFaceUpAttack(session, requireCard(session, lanceCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, worldLegacyAllyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, offSetTargetCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, opponentAttackerCode, 1), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredPreDamage({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 46647145, reader, workspace, main0: [lanceCode, linkAttackerCode], main1: [battleDefenderCode], extra0: [] });
  moveDuelCard(session.state, requireCard(session, lanceCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, linkAttackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleDefenderCode, 1), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredTokenTrigger({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 46647146, reader, workspace, main0: [lanceCode], main1: [], extra0: [extraSummonedCode] });
  moveFaceUpAttack(session, requireCard(session, lanceCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main0,
  main1,
  extra0,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main0: string[];
  main1: string[];
  extra0: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0, extra: extra0 }, 1: { main: main1 } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lanceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectLanceScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain('World Legacy - "World Lance"');
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.GetAttacker()");
  expect(script).toContain("Duel.GetAttackTarget()");
  expect(script).toContain("g:IsExists(Card.IsType,1,nil,TYPE_LINK)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-3000)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_WORLD_LEGACY) and c~=e:GetHandler()");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return eg:IsExists(Card.IsSummonLocation,1,nil,LOCATION_EXTRA)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,2,0,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,2,tp,0)");
  expect(script).toContain("Duel.CreateToken(tp,id+1)");
  expect(script).toContain("Duel.SpecialSummonStep(t1,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummonStep(t2,0,tp,1-tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: lanceCode, name: 'World Legacy - "World Lance"', kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWorldLegacy], race: raceMachine, attribute: attributeDark, level: 8, attack: 3000, defense: 0 },
    { code: tokenCode, name: "World Legacy Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, setcodes: [setWorldLegacy], race: raceMachine, attribute: attributeDark, level: 1, attack: 0, defense: 0 },
    { code: worldLegacyAllyCode, name: "World Legacy Lance Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWorldLegacy], race: raceMachine, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: offSetTargetCode, name: "World Legacy Lance Off-Set Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentAttackerCode, name: "World Legacy Lance Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: linkAttackerCode, name: "World Legacy Lance Link Attacker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceMachine, attribute: attributeDark, level: 2, attack: 2000, defense: 0, linkMarkers: 0x20 },
    { code: battleDefenderCode, name: "World Legacy Lance Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 4000, defense: 1000 },
    { code: extraSummonedCode, name: "World Legacy Lance Extra Summoned Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceMachine, attribute: attributeDark, level: 1, attack: 1000, defense: 0, linkMarkers: 0x20 },
  ];
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
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

function passUntilRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === uid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
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
