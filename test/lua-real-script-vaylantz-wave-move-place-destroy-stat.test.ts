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
const waveCode = "84281045";
const moverCode = "842810450";
const movedProbeCode = "842810451";
const vaylantzMonsterCode = "842810452";
const opponentMonsterCode = "842810453";
const opponentColumnSpellCode = "842810454";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWaveScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${waveCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const setVaylantz = 0x17e;
const raceMachine = 0x20;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasWaveScript)("Lua real script Vaylantz Wave move place destroy stat", () => {
  it("restores delayed EVENT_MOVE SelectEffect branch into cost, target placement, column destroy, and type change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${waveCode}.lua`);
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e2:SetCode(EVENT_MOVE)");
    expect(script).toContain("return c:IsLocation(LOCATION_MZONE) and c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("local op=Duel.SelectEffect(tp,");
    expect(script).toContain("e:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("Duel.SendtoGrave(c,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsType,TYPE_EFFECT),tp,0,LOCATION_MMZONE,1,1,nil,tp)");
    expect(script).toContain("Duel.GetFieldCard(1-tp,LOCATION_SZONE,tc:GetSequence())");
    expect(script).toContain("Duel.Destroy(dc,REASON_RULE)");
    expect(script).toContain("Duel.CheckLocation(1-tp,LOCATION_SZONE,seq)");
    expect(script).toContain("Duel.MoveToField(tc,tp,1-tp,LOCATION_SZONE,POS_FACEUP,tc:IsMonsterCard(),1<<seq)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_TYPE)");
    expect(script).toContain("e1:SetValue(TYPE_SPELL|TYPE_CONTINUOUS)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 84281045, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [waveCode, moverCode, movedProbeCode, vaylantzMonsterCode] }, 1: { main: [opponentMonsterCode, opponentColumnSpellCode] } });
    startDuel(session);
    const wave = requireCard(session, waveCode);
    const mover = requireCard(session, moverCode);
    const movedProbe = requireCard(session, movedProbeCode);
    const vaylantzMonster = requireCard(session, vaylantzMonsterCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentColumnSpell = requireCard(session, opponentColumnSpellCode);
    moveFaceUpSpell(session, wave, 0);
    moveDuelCard(session.state, mover.uid, "hand", 0);
    moveFaceUpAttack(session, vaylantzMonster, 0);
    moveFaceUpAttack(session, movedProbe, 0);
    movedProbe.sequence = 1;
    moveFaceUpAttack(session, opponentMonster, 1);
    moveFaceUpSpell(session, opponentColumnSpell, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${moverCode}.lua`) return moverScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(waveCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(moverCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const moveAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === mover.uid);
    expect(moveAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, moveAction!);
    passRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === movedProbe.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 2,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: mover.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1030",
        eventCardUid: movedProbe.uid,
        eventCode: 1030,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventName: "moved",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventReason: duelReason.effect,
        eventReasonCardUid: mover.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: wave.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }] });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === wave.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(trigger)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.host.promptDecisions.map((decision) => ({
      api: decision.api,
      player: decision.player,
      options: "options" in decision ? decision.options : undefined,
      returned: decision.returned,
    }))).toEqual([
      { api: "SelectEffect", player: 0, options: [1, 2], returned: 2 },
    ]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === wave.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: wave.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentColumnSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.rule | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: wave.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 1,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: wave.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === opponentMonster.uid && effect.code === 117)).toMatchObject({
      code: 117,
      value: typeSpell | typeContinuous,
      sourceUid: opponentMonster.uid,
      reset: { flags: 33296384 },
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === vaylantzMonster.uid), restoredTrigger.session.state)).toBe(2500);
    const relevantEvents = restoredTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "destroyed", "moved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }));
    expect(relevantEvents).toEqual([
      { eventName: "moved", eventCode: 1030, eventCardUid: movedProbe.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mover.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "monsterZone" },
      { eventName: "moved", eventCode: 1030, eventCardUid: wave.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: wave.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: wave.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: wave.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentMonster.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "moved", eventCode: 1030, eventCardUid: opponentColumnSpell.uid, eventReason: duelReason.rule | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: wave.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentColumnSpell.uid, eventReason: duelReason.rule | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: wave.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentColumnSpell.uid, eventReason: duelReason.rule | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: wave.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "moved", eventCode: 1030, eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: wave.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "spellTrapZone" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: waveCode, name: "Vaylantz Wave - Master Phase", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setVaylantz] },
    { code: moverCode, name: "Vaylantz Move Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: movedProbeCode, name: "Vaylantz Move Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: vaylantzMonsterCode, name: "High-Level Vaylantz Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeFire, level: 6, attack: 2500, defense: 2000, setcodes: [setVaylantz] },
    { code: opponentMonsterCode, name: "Vaylantz Opponent Effect Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeFire, level: 4, attack: 1600, defense: 1200 },
    { code: opponentColumnSpellCode, name: "Vaylantz Opponent Column Spell", kind: "spell", typeFlags: typeSpell | typeContinuous },
  ];
}

function moverScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${movedProbeCode}),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()
        Duel.MoveToField(tc,tp,tp,LOCATION_MZONE,POS_FACEUP_ATTACK,true,4)
      end)
      c:RegisterEffect(e)
    end
  `;
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
