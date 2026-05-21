import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const lightPhoenixCode = "59762399";
const performapalTargetCode = "597623990";
const decoyCode = "597623991";
const responderCode = "597623992";
const defenderCode = "597623993";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLightPhoenixScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lightPhoenixCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceWingedBeast = 0x80;
const raceSpellcaster = 0x2;
const attributeLight = 0x10;
const setPerformapal = 0x9f;

describe.skipIf(!hasUpstreamScripts || !hasLightPhoenixScript)("Lua real script Light Phoenix self tribute stat", () => {
  it("restores Damage Step quick SelfTribute cost into targeted Performapal ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lightPhoenixCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("e2:SetCost(Cost.SelfTribute)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 59762399, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lightPhoenixCode, performapalTargetCode, decoyCode] }, 1: { main: [responderCode, defenderCode] } });
    startDuel(session);

    const lightPhoenix = requireCard(session, lightPhoenixCode);
    const performapalTarget = requireCard(session, performapalTargetCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, lightPhoenix, 0);
    moveFaceUpAttack(session, performapalTarget, 0);
    moveFaceUpAttack(session, decoy, 0);
    moveFaceUpAttack(session, defender, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lightPhoenixCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === decoy.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    const opponentPass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, opponentPass!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lightPhoenix.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lightPhoenix.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: lightPhoenix.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-4",
        chainIndex: 1,
        effectId: "lua-4-1002",
        sourceUid: lightPhoenix.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [performapalTarget.uid],
        operationInfos: [{ category: 0x200000, targetUids: [performapalTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("light phoenix responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === performapalTarget.uid), restoredChain.session.state)).toBe(2800);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === decoy.uid), restoredChain.session.state)).toBe(1700);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "becameTarget", "chainSolved"].includes(event.eventName))).toEqual([
      releasedEvent(lightPhoenix.uid),
      becameTargetEvent(performapalTarget.uid),
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-4",
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: lightPhoenixCode, name: "Performapal Odd-Eyes Light Phoenix", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceWingedBeast, attribute: attributeLight, level: 5, attack: 2000, defense: 1000, setcodes: [setPerformapal] },
    { code: performapalTargetCode, name: "Light Phoenix Performapal Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1800, defense: 1000, setcodes: [setPerformapal] },
    { code: decoyCode, name: "Light Phoenix Non-Performapal Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1700, defense: 1000 },
    { code: responderCode, name: "Light Phoenix Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Light Phoenix Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
  ];
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("light phoenix responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
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

function releasedEvent(cardUid: string) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: cardUid,
    eventReason: duelReason.cost | duelReason.release,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
  };
}

function becameTargetEvent(cardUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 4,
    eventChainDepth: 1,
    eventChainLinkId: "chain-4",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
  };
}
