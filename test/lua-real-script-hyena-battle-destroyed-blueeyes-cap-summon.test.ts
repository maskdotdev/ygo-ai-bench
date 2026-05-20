import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hyenaCode = "22873798";
const hasHyenaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hyenaCode}.lua`));
const attackerCode = "22873799";
const spiritCapCode = "59822133";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasHyenaScript)("Lua real script Hyena battle destroyed Blue-Eyes Spirit cap summon", () => {
  it("restores battle-destroyed same-code Deck summons and caps them under CARD_BLUEEYES_SPIRIT", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${hyenaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)");
    expect(script).toContain("return c:IsCode(id) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("if Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT) then ft = 1 end");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,ft,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: hyenaCode, name: "Hyena", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1000, defense: 300 },
      { code: attackerCode, name: "Hyena Battle Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: spiritCapCode, name: "Blue-Eyes Spirit Cap Probe", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2500, defense: 2000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22873798, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hyenaCode, hyenaCode, hyenaCode, spiritCapCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const hyenas = session.state.cards.filter((card) => card.code === hyenaCode);
    expect(hyenas).toHaveLength(3);
    const destroyedHyena = hyenas[0]!;
    const deckHyenaA = hyenas[1]!;
    const deckHyenaB = hyenas[2]!;
    const attacker = requireCard(session, attackerCode);
    const spiritCap = requireCard(session, spiritCapCode);
    const movedHyena = moveDuelCard(session.state, destroyedHyena.uid, "monsterZone", 0);
    movedHyena.position = "faceUpAttack";
    movedHyena.faceUp = true;
    const movedAttacker = moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    movedAttacker.position = "faceUpAttack";
    movedAttacker.faceUp = true;
    const movedSpirit = moveDuelCard(session.state, spiritCap.uid, "monsterZone", 0);
    movedSpirit.position = "faceUpAttack";
    movedSpirit.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${spiritCapCode}.lua`) return blueEyesSpiritCapScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hyenaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spiritCapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === destroyedHyena.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredInitial, attack!);
    passBattleResponses(restoredInitial.session);
    expect(restoredInitial.session.state.cards.find((card) => card.uid === destroyedHyena.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker.uid,
    });
    expect(restoredInitial.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-6-1",
        effectId: "lua-1-1140",
        sourceUid: destroyedHyena.uid,
        triggerBucket: "opponentOptional",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: destroyedHyena.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const deckHyenaPreviousStates = new Map([
      [deckHyenaA.uid, cardEventState(deckHyenaA)],
      [deckHyenaB.uid, cardEventState(deckHyenaB)],
    ]);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedHyena.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === destroyedHyena.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    const summonedHyena = restoredTrigger.session.state.cards.find(
      (card) => card.code === hyenaCode && card.uid !== destroyedHyena.uid && card.location === "monsterZone",
    );
    const cappedHyena = restoredTrigger.session.state.cards.find(
      (card) => card.code === hyenaCode && card.uid !== destroyedHyena.uid && card.location === "deck",
    );
    expect(summonedHyena).toBeDefined();
    expect(cappedHyena).toBeDefined();
    expect(summonedHyena).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(cappedHyena).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === spiritCap.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: destroyedHyena.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonedHyena!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedHyena.uid,
        eventReasonEffectId: 1,
        eventUids: [summonedHyena!.uid],
        eventPreviousState: deckHyenaPreviousStates.get(summonedHyena!.uid),
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function blueEyesSpiritCapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(CARD_BLUEEYES_SPIRIT)
      e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetTargetRange(1,0)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: { controller: PlayerId; faceUp?: boolean; location: DuelLocation; position?: string; sequence: number }) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
  };
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
