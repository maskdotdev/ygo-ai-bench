import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const oniCode = "30494314";
const reviverCode = "304943140";
const targetCode = "304943141";
const xyzHolderCode = "304943142";
const materialCode = "304943143";
const defenderCode = "304943144";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOniScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${oniCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceZombie = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectUpdateLevel = 130;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasOniScript)("Lua real script Red-Headed Oni summon overlay level attack", () => {
  it("restores Zombie-effect Graveyard Special Summon trigger into overlay detach, Level gain, and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${oniCode}.lua`));
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${reviverCode}.lua`) return zombieReviverScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 30494314, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oniCode, reviverCode, targetCode, materialCode], extra: [xyzHolderCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const oni = requireCard(session, oniCode);
    const reviver = requireCard(session, reviverCode);
    const target = requireCard(session, targetCode);
    const xyzHolder = requireCard(session, xyzHolderCode);
    const material = requireCard(session, materialCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, oni.uid, "graveyard", 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, reviver, 0, 1);
    moveFaceUpAttack(session, xyzHolder, 0, 2);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz);
    xyzHolder.overlayUids.push(material.uid);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(oniCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(reviverCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const revive = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === reviver.uid);
    expect(revive, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, revive!);
    passChain(session);
    expect(session.state.cards.find((card) => card.uid === oni.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: reviver.uid,
      reasonEffectId: 2,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        sourceUid: oni.uid,
        effectId: "lua-1-1102",
        eventName: "specialSummoned",
        eventPlayer: 0,
        triggerBucket: "turnOptional",
        eventCode: eventSpecialSummonSuccess,
        eventTriggerTiming: "when",
        eventCardUid: oni.uid,
        eventUids: [oni.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: reviver.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 3 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === oni.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: oni.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === xyzHolder.uid)).toMatchObject({ location: "monsterZone", overlayUids: [] });
    expect(currentLevel(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), restoredTrigger.session.state)).toBe(5);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), restoredTrigger.session.state)).toBe(2000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && (effect.code === effectUpdateAttack || effect.code === effectUpdateLevel)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateLevel, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: target.uid, value: 1 },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: target.uid, value: 300 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "detachedMaterial"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: oni.uid,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-5",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: material.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: oni.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: oni.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentLevel(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(5);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(2000);
    restoredStat.session.state.phase = "battle";
    restoredStat.session.state.turnPlayer = 0;
    restoredStat.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredStat, 0);
    const attack = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "declareAttack" && action.attackerUid === target.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, attack!);
    passRestoredBattle(restoredStat);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_LVCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_GRAVE) and re:GetHandler():IsRace(RACE_ZOMBIE)");
  expect(script).toContain("Duel.CheckRemoveOverlayCard(tp,1,1,1,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.RemoveOverlayCard(tp,1,1,1,1,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e1:SetValue(1)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(300)");
}

function cards(): DuelCardData[] {
  return [
    { code: oniCode, name: "Red-Headed Oni", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: reviverCode, name: "Red-Headed Oni Zombie Reviver", kind: "monster", typeFlags: typeMonster | typeEffect | typeXyz, race: raceZombie, attribute: attributeDark, level: 4, attack: 1900, defense: 1200 },
    { code: targetCode, name: "Red-Headed Oni Boost Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: xyzHolderCode, name: "Red-Headed Oni Overlay Holder", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceZombie, attribute: attributeDark, level: 4, attack: 2100, defense: 1800 },
    { code: materialCode, name: "Red-Headed Oni Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Red-Headed Oni Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function zombieReviverScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetDescription(aux.Stringid(id,0))
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.filter(c,e,tp)
      return c:IsCode(${oniCode}) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsLocation(LOCATION_GRAVE) and chkc:IsControler(tp) and s.filter(chkc,e,tp) end
      if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
      local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)
      Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then
        Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK)
      end
    end
  `;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function passChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
