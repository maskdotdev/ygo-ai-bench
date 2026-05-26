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
const planCode = "15447747";
const materialCode = "154477470";
const linkCode = "154477471";
const gravePrankACode = "154477472";
const gravePrankBCode = "154477473";
const attackerCode = "154477474";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPlanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${planCode}.lua`));
const setPrankKids = 0x120;
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const typeLink = 0x4000000;
const racePyro = 0x80;
const attributeFire = 0x4;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPlanScript)("Lua real script Prank-Kids Plan main Link attack shuffle stat", () => {
  it("restores Main Phase Link Summon and opponent attack grave shuffle ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${planCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const linkWindow = createRestoredLinkWindow({ reader, workspace });
    expectCleanRestore(linkWindow.restored);
    expectRestoredLegalActions(linkWindow.restored, 0);
    const linkAction = getLuaRestoreLegalActions(linkWindow.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === linkWindow.plan.uid && action.effectId === "lua-2-1002"
    );
    expect(linkAction, JSON.stringify(getLuaRestoreLegalActions(linkWindow.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(linkWindow.restored, linkAction!);
    expect(linkWindow.restored.session.state.chain).toEqual([]);
    resolveRestoredChain(linkWindow.restored);
    expect(linkWindow.restored.session.state.flagEffects).toEqual([
      { ownerType: "player", ownerId: "0", code: Number(planCode), reset: 0x40000200, resetCount: 1, property: 0, value: 0, turn: 1 },
    ]);
    expect(linkWindow.restored.session.state.cards.find((card) => card.uid === linkWindow.plan.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(linkWindow.restored.session.state.cards.find((card) => card.uid === linkWindow.material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.link,
      reasonPlayer: 0,
      reasonCardUid: linkWindow.link.uid,
      reasonEffectId: 2,
    });
    expect(linkWindow.restored.session.state.cards.find((card) => card.uid === linkWindow.link.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "link",
      summonMaterialUids: [linkWindow.material.uid],
      reason: duelReason.summon | duelReason.specialSummon | duelReason.link,
      reasonPlayer: 0,
      reasonCardUid: linkWindow.plan.uid,
      reasonEffectId: 2,
    });
    expect(linkWindow.restored.session.state.eventHistory.filter((event) => ["preUsedAsMaterial", "sentToGraveyard", "usedAsMaterial", "specialSummoning", "specialSummoned", "chainSolved"].includes(event.eventName)).map((event) => ({
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
      { eventName: "preUsedAsMaterial", eventCode: 1109, eventCardUid: linkWindow.material.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: linkWindow.material.uid, eventReason: duelReason.material | duelReason.link, eventReasonPlayer: 0, eventReasonCardUid: linkWindow.link.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "graveyard" },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: linkWindow.material.uid, eventReason: duelReason.material | duelReason.link, eventReasonPlayer: 0, eventReasonCardUid: linkWindow.link.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoning", eventCode: 1105, eventCardUid: linkWindow.link.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link, eventReasonPlayer: 0, eventReasonCardUid: linkWindow.plan.uid, eventReasonEffectId: 2, previous: "extraDeck", current: "extraDeck" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: linkWindow.link.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link, eventReasonPlayer: 0, eventReasonCardUid: linkWindow.plan.uid, eventReasonEffectId: 2, previous: "extraDeck", current: "monsterZone" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
    ]);
    expect(linkWindow.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const attackWindow = createRestoredAttackWindow({ reader, workspace });
    expectCleanRestore(attackWindow.restored);
    expectRestoredLegalActions(attackWindow.restored, 1);
    const attack = getLuaRestoreLegalActions(attackWindow.restored, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attackWindow.attacker.uid && action.targetUid === undefined
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(attackWindow.restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(attackWindow.restored, attack!);
    expect(attackWindow.restored.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1130",
        eventCardUid: attackWindow.attacker.uid,
        eventCode: 1130,
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "attackDeclared",
        eventPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: attackWindow.plan.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(attackWindow.restored.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === attackWindow.plan.uid && action.effectId === "lua-3-1130"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === attackWindow.plan.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: attackWindow.plan.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === attackWindow.gravePrankA.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: attackWindow.plan.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === attackWindow.gravePrankB.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: attackWindow.plan.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === attackWindow.attacker.uid), restoredTrigger.session.state)).toBe(1600);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === attackWindow.attacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: attackWindow.attacker.uid, value: -200 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "banished", "sentToDeck", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: attackWindow.attacker.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: attackWindow.plan.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: attackWindow.plan.uid, eventReasonEffectId: 3, eventUids: undefined, previous: "graveyard", current: "banished" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: attackWindow.gravePrankA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: attackWindow.plan.uid, eventReasonEffectId: 3, eventUids: undefined, previous: "graveyard", current: "deck" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: attackWindow.gravePrankB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: attackWindow.plan.uid, eventReasonEffectId: 3, eventUids: undefined, previous: "graveyard", current: "deck" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: attackWindow.gravePrankA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: attackWindow.plan.uid, eventReasonEffectId: 3, eventUids: [attackWindow.gravePrankA.uid, attackWindow.gravePrankB.uid], previous: "graveyard", current: "deck" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: undefined, current: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredLinkWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  plan: DuelCardInstance;
  material: DuelCardInstance;
  link: DuelCardInstance;
} {
  const session = createDuel({ seed: 15447747, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [planCode, materialCode], extra: [linkCode] }, 1: { main: [] } });
  startDuel(session);
  const plan = requireCard(session, planCode);
  const material = requireCard(session, materialCode);
  const link = requireCard(session, linkCode);
  moveFaceUpSpellTrap(session, plan, 0, 0);
  moveFaceUpAttack(session, material, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(planCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  return { restored, plan, material, link };
}

function createRestoredAttackWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  plan: DuelCardInstance;
  gravePrankA: DuelCardInstance;
  gravePrankB: DuelCardInstance;
  attacker: DuelCardInstance;
} {
  const session = createDuel({ seed: 15447748, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [planCode, gravePrankACode, gravePrankBCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  const plan = requireCard(session, planCode);
  const gravePrankA = requireCard(session, gravePrankACode);
  const gravePrankB = requireCard(session, gravePrankBCode);
  const attacker = requireCard(session, attackerCode);
  moveDuelCard(session.state, plan.uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, gravePrankA.uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, gravePrankB.uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, attacker, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(planCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  return { restored, plan, gravePrankA, gravePrankB, attacker };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Prank-Kids Plan");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
  expect(script).toContain("return Duel.IsMainPhase()");
  expect(script).toContain("Duel.GetFlagEffect(tp,id)==0");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_PRANK_KIDS),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.lkfilter,tp,LOCATION_EXTRA,0,1,1,nil,mg)");
  expect(script).toContain("Duel.LinkSummon(tp,tc,nil,mg)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TODECK+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return Duel.GetAttacker():IsControler(1-tp)");
  expect(script).toContain("Duel.SendtoDeck(sg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("local oc=#(Duel.GetOperatedGroup())");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(oc*-100)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const plan = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === planCode);
  expect(plan).toBeDefined();
  return [
    { ...plan!, kind: "trap", typeFlags: typeTrap | typeContinuous, setcodes: [setPrankKids] },
    prankMonster(materialCode, "Prank-Kids Plan Link Material", 1000, 1000),
    { code: linkCode, name: "Prank-Kids Plan Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setPrankKids], race: racePyro, attribute: attributeFire, level: 1, attack: 1800, defense: 0, linkMarkers: 0x20, linkMaterialMin: 1, linkMaterialMax: 1, linkMaterialSetcode: setPrankKids },
    prankMonster(gravePrankACode, "Prank-Kids Plan Grave A", 1000, 1000),
    prankMonster(gravePrankBCode, "Prank-Kids Plan Grave B", 1000, 1000),
    { code: attackerCode, name: "Prank-Kids Plan Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
  ];
}

function prankMonster(code: string, name: string, attack: number, defense: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPrankKids], race: racePyro, attribute: attributeFire, level: 4, attack, defense };
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
