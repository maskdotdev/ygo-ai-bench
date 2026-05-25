import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const vortexCode = "42138622";
const callCode = "97077563";
const zombieCode = "421386220";
const effectMonsterCode = "421386221";
const banishTargetCode = "421386222";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVortexScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vortexCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const raceZombie = 0x10;
const categoryCoin = 0x1000000;
const categoryDamage = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasVortexScript)("Lua real script Vortex of Time chain operation replace", () => {
  it("restores a coin-selected ChangeChainOperation that banishes instead of resolving the original effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vortexCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${effectMonsterCode}.lua`) return opponentMonsterScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vortexCode, callCode, zombieCode] }, 1: { main: [effectMonsterCode, banishTargetCode] } });
    startDuel(session);

    const vortex = requireCard(session, vortexCode);
    const call = requireCard(session, callCode);
    const zombie = requireCard(session, zombieCode);
    const effectMonster = requireCard(session, effectMonsterCode);
    const banishTarget = requireCard(session, banishTargetCode);
    moveSetSpellTrap(session, vortex, 0, 0);
    moveFaceUpSpellTrap(session, call, 0, 1);
    moveFaceUpAttack(session, zombie, 0, 0);
    moveFaceUpAttack(session, effectMonster, 1, 0);
    moveFaceUpAttack(session, banishTarget, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;
    session.state.players[0].lifePoints = 8000;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vortexCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(effectMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const opponentActivation = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === effectMonster.uid);
    expect(opponentActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestored(restoredOpen, opponentActivation!);
    expect(restoredOpen.session.state.chain.map(({ targetFieldIds: _targetFieldIds, ...link }) => link)).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: effectMonster.uid,
        player: 1,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: categoryDamage, targetUids: [zombie.uid], count: 0, player: 0, parameter: 400 }],
        targetUids: [zombie.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    const vortexResponse = getLuaRestoreLegalActions(restoredChain, 0).find((action) => action.type === "activateEffect" && action.uid === vortex.uid);
    expect(vortexResponse, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 0), null, 2)).toBeDefined();
    applyRestored(restoredChain, vortexResponse!);

    const restoredResolution = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredResolution);
    passRestoredChain(restoredResolution);
    expectCleanRestore(restoredResolution);
    expectRestoredLegalActions(restoredResolution, 1);

    expect(restoredResolution.session.state.chain).toEqual([]);
    expect(restoredResolution.session.state.lastCoinResults).toEqual([1]);
    expect(restoredResolution.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredResolution.session.state.cards.find((card) => card.uid === zombie.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.rule,
      reasonPlayer: 1,
      reasonCardUid: effectMonster.uid,
      reasonEffectId: 2,
    });
    expect(restoredResolution.session.state.cards.find((card) => card.uid === effectMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restoredResolution.session.state.cards.find((card) => card.uid === banishTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restoredResolution.session.state.eventHistory.filter((event) => ["coinTossed", "damageDealt", "banished"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 1,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: vortex.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: zombie.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 1,
        eventReasonCardUid: effectMonster.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Vortex of Time");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("rp==1-tp and (re:IsMonsterEffect()");
  expect(script).toContain("aux.FaceupFilter(Card.IsRace,RACE_ZOMBIE)");
  expect(script).toContain("aux.FaceupFilter(Card.IsCode,CARD_CALL_OF_THE_HAUNTED)");
  expect(script).toContain("Duel.ChangeTargetCard(ev,g)");
  expect(script).toContain("local coin=Duel.TossCoin(1-tp,1)");
  expect(script).toContain("Duel.ChangeChainOperation(ev,s.repop1)");
  expect(script).toContain("Duel.ChangeChainOperation(ev,s.repop2)");
  expect(script).toContain("Duel.SelectMatchingCard(opp,Card.IsAbleToRemove,opp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_RULE,PLAYER_NONE,opp)");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_MZONE,0)");
}

function opponentMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetDescription(aux.Stringid(id,0))
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil) end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TARGET)
        local g=Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)
        Duel.SetOperationInfo(0,CATEGORY_DAMAGE,g,0,1-tp,400)
      end)
      e:SetOperation(function(e,tp)
        Duel.Damage(1-tp,400,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: vortexCode, name: "Vortex of Time", kind: "trap", typeFlags: typeTrap },
    { code: callCode, name: "Call of the Haunted", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: zombieCode, name: "Vortex Zombie", kind: "monster", typeFlags: typeMonster, race: raceZombie, level: 4, attack: 1000, defense: 1000 },
    { code: effectMonsterCode, name: "Vortex Opponent Effect Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: banishTargetCode, name: "Vortex Banish Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveSetSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestored(restored, pass!);
  }
}
