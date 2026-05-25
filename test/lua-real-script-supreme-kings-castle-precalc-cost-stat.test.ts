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
const castleCode = "72043279";
const fiendAttackerCode = "720432790";
const evilHeroCostCode = "720432791";
const costDecoyCode = "720432792";
const defenderCode = "720432793";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCastleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${castleCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setEvilHero = 0x6008;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCastleScript)("Lua real script Supreme King's Castle pre-calc cost stat", () => {
  it("restores Field Spell pre-damage trigger sending Evil HERO cost into Level-scaled Fiend ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${castleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredBattleOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const castle = requireCard(restoredOpen.session, castleCode);
    const attacker = requireCard(restoredOpen.session, fiendAttackerCode);
    const evilHeroCost = requireCard(restoredOpen.session, evilHeroCostCode);
    const costDecoy = requireCard(restoredOpen.session, costDecoyCode);
    const defender = requireCard(restoredOpen.session, defenderCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === castle.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 1002, event: "ignition", property: undefined, range: ["hand", "spellTrapZone"], targetRange: undefined },
      { code: Number(castleCode), event: "continuous", property: 0x4000800, range: ["spellTrapZone"], targetRange: [1, 0] },
      { code: 1134, event: "trigger", property: undefined, range: ["spellTrapZone"], targetRange: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passRestoredBattleUntil(restoredOpen, () =>
      findRestoredAction(restoredOpen, [1, 0], (action) =>
        action.type === "activateTrigger" && action.uid === castle.uid && action.effectId === "lua-3-1134"
      ) !== undefined
    );

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    const preDamagePlayer = restoredPreDamage.session.state.waitingFor ?? restoredPreDamage.session.state.turnPlayer;
    expectRestoredLegalActions(restoredPreDamage, preDamagePlayer);
    expect(restoredPreDamage.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === castle.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1134",
        effectLabelObjectUid: attacker.uid,
        eventCardUid: attacker.uid,
        eventCode: 1134,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "beforeDamageCalculation",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [attacker.uid, defender.uid],
        player: 0,
        sourceUid: castle.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredPreDamage, preDamagePlayer).find((action) =>
      action.type === "activateTrigger" && action.uid === castle.uid && action.effectId === "lua-3-1134"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, preDamagePlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, trigger!);
    resolveRestoredChain(restoredPreDamage);

    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === evilHeroCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: castle.uid,
      reasonEffectId: 3,
    });
    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === costDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(findCard(restoredPreDamage.session, attacker.uid), restoredPreDamage.session.state)).toBe(2900);
    expect(restoredPreDamage.session.state.effects.filter((effect) =>
      effect.sourceUid === attacker.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: attacker.uid, value: 1400 },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) =>
      ["sentToGraveyard", "chainSolved"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: evilHeroCost.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: castle.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventValue: undefined, relatedEffectId: undefined },
      { eventCardUid: undefined, eventCode: 1022, eventName: "chainSolved", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventValue: 1, relatedEffectId: 3 },
    ]);
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBattleOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 72043279, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [castleCode, fiendAttackerCode, evilHeroCostCode, costDecoyCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpSpellTrap(session, requireCard(session, castleCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, fiendAttackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(castleCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const castle = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === castleCode);
  expect(castle).toBeDefined();
  return [
    { ...castle!, kind: "spell", typeFlags: typeSpell | typeField },
    { code: fiendAttackerCode, name: "Supreme King's Castle Fixture Fiend", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: evilHeroCostCode, name: "Supreme King's Castle Fixture Evil HERO", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setEvilHero], race: raceFiend, attribute: attributeDark, level: 7, attack: 2200, defense: 1000 },
    { code: costDecoyCode, name: "Supreme King's Castle Fixture Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], race: raceFiend, attribute: attributeDark, level: 9, attack: 2400, defense: 1000 },
    { code: defenderCode, name: "Supreme King's Castle Fixture Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Supreme King's Castle");
  expect(script).toContain("e2:SetCode(id)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
  expect(script).toContain("e2:SetTargetRange(1,0)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e3:SetRange(LOCATION_FZONE)");
  expect(script).toContain("e3:SetCountLimit(1)");
  expect(script).toContain("local tc=Duel.GetAttacker()");
  expect(script).toContain("local bc=Duel.GetAttackTarget()");
  expect(script).toContain("e:SetLabelObject(bc)");
  expect(script).toContain("return bc:IsFaceup() and bc:IsRace(RACE_FIEND)");
  expect(script).toContain("return c:IsMonster() and c:IsSetCard(SET_EVIL_HERO) and c:HasLevel() and c:IsAbleToGraveAsCost()");
  expect(script).toContain("Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_COST)");
  expect(script).toContain("e:SetLabel(tc:GetLevel())");
  expect(script).toContain("local ct=e:GetLabel()*200");
  expect(script).toContain("tc:IsRelateToBattle() and tc:IsFaceup() and tc:IsControler(tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function findRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, players: PlayerId[], predicate: (action: DuelAction) => boolean): DuelAction | undefined {
  for (const player of players) {
    const action = getLuaRestoreLegalActions(restored, player).find(predicate);
    if (action) return action;
  }
  return undefined;
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

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
