import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mesmerismCode = "42899204";
const evilEyeMonsterCode = "428992040";
const opponentSummonerCode = "428992041";
const opponentTargetCode = "428992042";
const seleneCode = "44133040";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMesmerismScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mesmerismCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const typeEquip = 0x40000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setEvilEye = 0x129;
const categoryControl = 0x2000;
const eventSpecialSummonSuccess = 1102;
const eventChainSolved = 1022;
const eventLeaveField = 1015;
const effectSetControl = 4;
const effectAddSetcode = 334;
const effectFlagCardTarget = 0x10;
const effectFlagSetAvailable = 0x100;
const effectFlagCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasMesmerismScript)("Lua real script Evil Eye Mesmerism persistent control", () => {
  it("restores Special Summon trap activation into persistent target control and Evil Eye setcode", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const source = withOpponentSummoner(workspace);
    expectScriptShape(workspace.readScript(`official/c${mesmerismCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 42899204, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mesmerismCode, evilEyeMonsterCode, seleneCode] }, 1: { main: [opponentSummonerCode, opponentTargetCode] } });
    startDuel(session);

    const mesmerism = requireCard(session, mesmerismCode);
    const evilEyeMonster = requireCard(session, evilEyeMonsterCode);
    const selene = requireCard(session, seleneCode);
    const opponentSummoner = requireCard(session, opponentSummonerCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    setTrap(session, mesmerism);
    moveFaceUpAttack(session, evilEyeMonster, 0, 0);
    const equipped = moveDuelCard(session.state, selene.uid, "spellTrapZone", 0);
    equipped.faceUp = true;
    equipped.position = "faceUpAttack";
    moveFaceUpAttack(session, opponentSummoner, 1, 0);
    moveDuelCard(session.state, opponentTarget.uid, "hand", 1);
    prepareMainPhase(session, 1);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mesmerismCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSummonerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const summon = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSummoner.uid);
    expect(summon, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);
    resolveChain(session);
    const starter = getLegalActions(session, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === opponentSummoner.uid
    );
    expect(starter, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starter!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === mesmerism.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: eventSpecialSummonSuccess, event: "quick", id: `lua-1-${eventSpecialSummonSuccess}`, property: effectFlagCardTarget, range: ["spellTrapZone"], triggerEvent: "specialSummoned" },
      { category: undefined, code: eventChainSolved, event: "continuous", id: `lua-2-${eventChainSolved}`, property: effectFlagCannotDisable, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectSetControl, event: "continuous", id: `lua-3-${effectSetControl}`, property: effectFlagSetAvailable, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectAddSetcode, event: "continuous", id: `lua-4-${effectAddSetcode}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventLeaveField, event: "continuous", id: `lua-5-${eventLeaveField}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const activate = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateEffect" && action.uid === mesmerism.uid && action.effectId === `lua-1-${eventSpecialSummonSuccess}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, activate!);
    resolveRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, mesmerism.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      cardTargetUids: [opponentTarget.uid],
    });
    expect(findCard(restoredTrigger.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: mesmerism.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.effects.some((effect) =>
      effect.sourceUid === opponentTarget.uid && effect.code === effectSetControl && effect.value === 0
    )).toBe(true);
    expect(restoredTrigger.session.state.effects.some((effect) =>
      effect.sourceUid === mesmerism.uid && effect.code === effectAddSetcode && effect.range?.includes("spellTrapZone")
    )).toBe(true);
  });
});

function withOpponentSummoner(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): LuaScriptSource {
  return {
    readScript(name) {
      if (name === `c${opponentSummonerCode}.lua`) return opponentSummonerScript();
      return workspace.readScript(name);
    },
  };
}

function opponentSummonerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_HAND,0,1,nil,${opponentTargetCode}) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(Card.IsCode,tp,LOCATION_HAND,0,nil,${opponentTargetCode})
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
      c:RegisterEffect(e)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_TRIGGER_O)
      e2:SetCode(EVENT_SPSUMMON_SUCCESS)
      e2:SetRange(LOCATION_MZONE)
      e2:SetOperation(function(e,tp) Debug.Message("mesmerism chain starter resolved") end)
      c:RegisterEffect(e2)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: mesmerismCode, name: "Evil Eye Mesmerism", kind: "trap", typeFlags: typeTrap | typeContinuous, setcodes: [setEvilEye] },
    { code: evilEyeMonsterCode, name: "Evil Eye Mesmerism Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setEvilEye], level: 4, attack: 2400, defense: 1200 },
    { code: seleneCode, name: "Evil Eye of Selene", kind: "spell", typeFlags: typeSpell | typeEquip, setcodes: [setEvilEye] },
    { code: opponentSummonerCode, name: "Mesmerism Opponent Summoner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentTargetCode, name: "Mesmerism Special Summoned Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Evil Eye Mesmerism");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("e2:SetCondition(aux.PersistentTgCon)");
  expect(script).toContain("c:SetCardTarget(tc)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_CONTROL)");
  expect(script).toContain("e3:SetTarget(aux.PersistentTargetFilter)");
  expect(script).toContain("e4:SetCode(EFFECT_ADD_SETCODE)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_EVIL_EYE_SELENE)");
  expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");
}

function prepareMainPhase(session: DuelSession, player: PlayerId): void {
  session.state.phase = "main1";
  session.state.turnPlayer = player;
  session.state.waitingFor = player;
}

function setTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function resolveChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
