import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentAttribute } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const neoTempestCode = "64211118";
const cyberseSendCode = "642111180";
const opponentMonsterCode = "642111181";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNeoTempestScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${neoTempestCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectAddAttribute = 125;
const effectUpdateAttack = 100;
const effectExtraAttackMonster = 346;

describe.skipIf(!hasUpstreamScripts || !hasNeoTempestScript)("Lua real script Neo Tempest send attribute negate stat", () => {
  it("restores Battle Phase monster-effect negate and Damage Step Cyberse send into Attribute and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectNeoTempestScriptShape(workspace.readScript(`official/c${neoTempestCode}.lua`));
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${opponentMonsterCode}.lua`) return opponentMonsterScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`missing script ${name}`);
        return loaded;
      },
    };
    const session = createDuel({ seed: 64211118, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cyberseSendCode], extra: [neoTempestCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const neoTempest = requireCard(session, neoTempestCode);
    const cyberseSend = requireCard(session, cyberseSendCode);
    const opponent = requireCard(session, opponentMonsterCode);
    moveFaceUpAttack(session, neoTempest, 0, 0);
    neoTempest.summonType = "link";
    neoTempest.summonPlayer = 0;
    moveFaceUpAttack(session, opponent, 1, 0);
    setDeckSequence(cyberseSend, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(neoTempestCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === neoTempest.uid && effect.code === effectExtraAttackMonster).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectExtraAttackMonster, event: "continuous", sourceUid: neoTempest.uid, value: undefined }]);

    const restoredOpponentOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpponentOpen);
    expectRestoredLegalActions(restoredOpponentOpen, 1);
    const opponentEffect = getLuaRestoreLegalActions(restoredOpponentOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponent.uid);
    expect(opponentEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpponentOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpponentOpen, opponentEffect!);
    restoredOpponentOpen.session.state.phase = "battle";
    passRestoredChain(restoredOpponentOpen);
    expect(restoredOpponentOpen.host.messages).not.toContain("neo tempest opponent monster resolved");
    expect(restoredOpponentOpen.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
    ]);

    restoredOpponentOpen.session.state.waitingFor = 0;
    restoredOpponentOpen.session.state.turnPlayer = 0;
    restoredOpponentOpen.session.state.phase = "main1";
    const restoredStatOpen = restoreDuelWithLuaScripts(serializeDuel(restoredOpponentOpen.session), source, reader);
    expectCleanRestore(restoredStatOpen);
    expectRestoredLegalActions(restoredStatOpen, 0);
    const sendAndBoost = getLuaRestoreLegalActions(restoredStatOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === neoTempest.uid && action.effectId === "lua-3-1002"
    );
    expect(sendAndBoost, JSON.stringify(getLuaRestoreLegalActions(restoredStatOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStatOpen, sendAndBoost!);
    resolveRestoredChain(restoredStatOpen);
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === cyberseSend.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: neoTempest.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredStatOpen.session.state.cards.find((card) => card.uid === neoTempest.uid), restoredStatOpen.session.state)).toBe(5500);
    expect((currentAttribute(restoredStatOpen.session.state.cards.find((card) => card.uid === neoTempest.uid), restoredStatOpen.session.state) & attributeDark) !== 0).toBe(true);
    expect(restoredStatOpen.session.state.effects.filter((effect) => effect.sourceUid === neoTempest.uid && [effectAddAttribute, effectUpdateAttack, effectExtraAttackMonster].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttackMonster, event: "continuous", property: undefined, range: ["monsterZone"], reset: undefined, sourceUid: neoTempest.uid, value: undefined },
      { code: effectAddAttribute, event: "continuous", property: 0x20000, range: ["monsterZone"], reset: { flags: 33492992 }, sourceUid: neoTempest.uid, value: attributeDark },
      { code: effectUpdateAttack, event: "continuous", property: 0x20000, range: ["monsterZone"], reset: { flags: 33492992 }, sourceUid: neoTempest.uid, value: 2500 },
    ]);
    expect(restoredStatOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: cyberseSend.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: neoTempest.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "graveyard" },
    ]);
    expect(restoredStatOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectNeoTempestScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Firewall Dragon Darkfluid - Neo Tempest Terahertz");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_CYBERSE),3)");
  expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("Duel.IsBattlePhase() and rp==1-tp and re:IsMonsterEffect() and Duel.IsChainDisablable(ev)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.tgfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SendtoGrave(sc,REASON_EFFECT)>0");
  expect(script).toContain("e1:SetCode(EFFECT_ADD_ATTRIBUTE)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
}

function cards(): DuelCardData[] {
  return [
    { code: neoTempestCode, name: "Firewall Dragon Darkfluid - Neo Tempest Terahertz", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 0, attack: 3000, defense: 0 },
    { code: cyberseSendCode, name: "Neo Tempest DARK Cyberse Send", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: opponentMonsterCode, name: "Neo Tempest Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
  ];
}

function opponentMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("neo tempest opponent monster resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
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

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.sequence = sequence;
  card.location = "deck";
  card.controller = card.owner;
  card.faceUp = false;
  card.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  resolveRestoredChain(restored);
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
