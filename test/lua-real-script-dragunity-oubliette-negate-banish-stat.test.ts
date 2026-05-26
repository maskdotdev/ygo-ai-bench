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
const oublietteCode = "51849216";
const dragunitySynchroCode = "518492160";
const ownBanishedCode = "518492161";
const opponentBanishedCode = "518492162";
const opponentSpellCode = "518492163";
const defenderCode = "518492164";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOublietteScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${oublietteCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeWind = 0x10;
const attributeEarth = 0x08;
const setDragunity = 0x29;

describe.skipIf(!hasUpstreamScripts || !hasOublietteScript)("Lua real script Dragunity Oubliette negate banish stat", () => {
  it("restores activation negation banish into operated-group prompt and Dragunity ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${oublietteCode}.lua`));
    const reader = createCardReader(cards());
    const source = opponentSpellSource(workspace);
    const session = createDuel({ seed: 51849216, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oublietteCode, ownBanishedCode], extra: [dragunitySynchroCode] }, 1: { main: [opponentSpellCode, opponentBanishedCode, defenderCode] } });
    startDuel(session);

    const oubliette = requireCard(session, oublietteCode);
    const dragunitySynchro = requireCard(session, dragunitySynchroCode);
    const ownBanished = requireCard(session, ownBanishedCode);
    const opponentBanished = requireCard(session, opponentBanishedCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const defender = requireCard(session, defenderCode);
    moveFaceDownTrap(session, oubliette);
    moveFaceUpAttack(session, dragunitySynchro, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    moveFaceUpBanished(session, ownBanished, 0);
    moveFaceUpBanished(session, opponentBanished, 1);
    moveDuelCard(session.state, opponentSpell.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(oublietteCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const spell = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spell, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, spell!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === oubliette.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    passRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("dragunity oubliette opponent spell resolved");
    expect(restoredResponse.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, returned: true });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: oubliette.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === dragunitySynchro.uid), restoredResponse.session.state)).toBe(3300);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === dragunitySynchro.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 100, property: undefined, reset: { flags: 33427456 }, sourceUid: dragunitySynchro.uid, value: 300 }]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["banished", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: opponentSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: oubliette.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "banished", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 2,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 2,
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === dragunitySynchro.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("return Duel.IsChainNegatable(ev) and re:IsHasType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("Duel.IsPlayerCanRemove(tp)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Remove(eg,POS_FACEUP,REASON_EFFECT)>0");
  expect(script).toContain("local og=Duel.GetOperatedGroup()");
  expect(script).toContain("not og:GetFirst():IsLocation(LOCATION_REMOVED)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsFaceup),tp,LOCATION_REMOVED,LOCATION_REMOVED,nil)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler())");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsSetCard,SET_DRAGUNITY),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*100)");
}

function cards(): DuelCardData[] {
  return [
    { code: oublietteCode, name: "Dragunity Oubliette", kind: "trap", typeFlags: typeTrap },
    { code: dragunitySynchroCode, name: "Dragunity Oubliette Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, attribute: attributeWind, setcodes: [setDragunity], level: 10, attack: 3000, defense: 2500 },
    { code: ownBanishedCode, name: "Dragunity Oubliette Own Banished", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, setcodes: [setDragunity], level: 4, attack: 1000, defense: 1000 },
    { code: opponentBanishedCode, name: "Dragunity Oubliette Opponent Banished", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: opponentSpellCode, name: "Dragunity Oubliette Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: defenderCode, name: "Dragunity Oubliette Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
  ];
}

function opponentSpellSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
      return workspace.readScript(name);
    },
  };
}

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("dragunity oubliette opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence?: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  if (sequence !== undefined) moved.sequence = sequence;
}

function moveFaceUpBanished(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "banished", player);
  moved.faceUp = true;
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
