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
const acidCode = "29095552";
const ownMonsterCode = "290955520";
const opponentMonsterACode = "290955521";
const opponentMonsterBCode = "290955522";
const opponentSpellCode = "290955523";
const opponentTrapCode = "290955524";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAcidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${acidCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasAcidScript)("Lua real script Masked HERO Acid summon backrow destroy stat", () => {
  it("restores mandatory Special Summon trigger into opponent Spell/Trap destruction and monster ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${acidCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 29095552, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [ownMonsterCode], extra: [acidCode] },
      1: { main: [opponentMonsterACode, opponentMonsterBCode, opponentSpellCode, opponentTrapCode] },
    });
    startDuel(session);

    const acid = requireCard(session, acidCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentMonsterA = requireCard(session, opponentMonsterACode);
    const opponentMonsterB = requireCard(session, opponentMonsterBCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    moveFaceUpAttack(session, acid, 0);
    acid.summonType = "special";
    moveFaceUpAttack(session, ownMonster, 0);
    moveFaceUpAttack(session, opponentMonsterA, 1);
    moveFaceUpAttack(session, opponentMonsterB, 1);
    moveFaceUpSpellTrap(session, opponentSpell, 1).sequence = 0;
    moveFaceUpSpellTrap(session, opponentTrap, 1).sequence = 1;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(acidCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === acid.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      value: effect.value,
      valueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { code: 31, event: "continuous", property: 0x40000 | 0x400, value: undefined, valueDescriptor: undefined },
      { code: 30, event: "continuous", property: 0x40000 | 0x400, value: undefined, valueDescriptor: "special-summon-condition:false" },
      { code: 1102, event: "trigger", property: undefined, value: undefined, valueDescriptor: undefined },
    ]);
    const summonSuccess = host.loadScript(
      `
      local acid=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${acidCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(acid, EVENT_SPSUMMON_SUCCESS, nil, REASON_SPSUMMON, 0, 0, 0)
      Debug.Message("masked hero acid summon success raised")
      `,
      "masked-hero-acid-summon-success.lua",
    );
    expect(summonSuccess.ok, summonSuccess.error).toBe(true);
    expect(host.messages).toContain("masked hero acid summon success raised");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      {
        sourceUid: acid.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: acid.uid,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === acid.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect("operationInfos" in trigger!).toBe(false);
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: acid.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTrap.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: acid.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownMonster.uid), restoredTrigger.session.state)).toBe(1700);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentMonsterA.uid), restoredTrigger.session.state)).toBe(1700);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentMonsterB.uid), restoredTrigger.session.state)).toBe(2100);
    expect(restoredTrigger.session.state.effects.filter((effect) => [opponentMonsterA.uid, opponentMonsterB.uid].includes(effect.sourceUid) && effect.code === 100).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, sourceUid: opponentMonsterA.uid, reset: { flags: 33427456 }, value: -300 },
      { code: 100, sourceUid: opponentMonsterB.uid, reset: { flags: 33427456 }, value: -300 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: acid.uid, eventReason: duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "extraDeck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: acid.uid, eventReasonEffectId: 3, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTrap.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: acid.uid, eventReasonEffectId: 3, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: acid.uid, eventReasonEffectId: 3, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e1:SetValue(aux.FALSE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_TRIGGER_F+EFFECT_TYPE_SINGLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_ONFIELD,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
  expect(script).toContain("if Duel.Destroy(g,REASON_EFFECT)>0 then");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-300)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: acidCode, name: "Masked HERO Acid", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeWater, level: 8, attack: 2600, defense: 2100 },
    { code: ownMonsterCode, name: "Masked HERO Acid Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: opponentMonsterACode, name: "Masked HERO Acid Opponent Monster A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: opponentMonsterBCode, name: "Masked HERO Acid Opponent Monster B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
    { code: opponentSpellCode, name: "Masked HERO Acid Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTrapCode, name: "Masked HERO Acid Opponent Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
