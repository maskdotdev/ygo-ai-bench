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
const varefarCode = "19743887";
const revealSpellCode = "197438870";
const targetCode = "197438871";
const attackerCode = "197438872";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVarefarScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${varefarCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceBeastWarrior = 0x8;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasVarefarScript)("Lua real script VARefar battle-target reveal Spell stat", () => {
  it("restores battle-target hand Special Summon into optional Spell reveal ATK set and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${varefarCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 19743887, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [varefarCode, revealSpellCode, targetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const varefar = requireCard(session, varefarCode);
    const revealSpell = requireCard(session, revealSpellCode);
    const target = requireCard(session, targetCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, varefar.uid, "hand", 0);
    moveDuelCard(session.state, revealSpell.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(varefarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: target.uid });
    expect(session.state.pendingTriggers).toEqual([]);
    expect(getLegalActions(session, 0).map(({ windowToken: _windowToken, ...action }) => action)).toEqual([
      {
        type: "activateEffect",
        player: 0,
        uid: varefar.uid,
        effectId: "lua-2-1131",
        label: "VARefar, the Judge of Ball: lua-2-1131",
        windowId: 1,
        windowKind: "battle",
      },
      {
        type: "passAttack",
        player: 0,
        label: "Pass attack response",
        windowId: 1,
        windowKind: "battle",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const response = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === varefar.uid);
    expect(response, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, response!);

    const state = restored.session.state;
    expect(restored.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 315902193, returned: true }]);
    expect(restored.host.messages).toContain(`confirmed 1: ${revealSpellCode}`);
    expect(state.cards.find((card) => card.uid === varefar.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: varefar.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(state.cards.find((card) => card.uid === attacker.uid), state)).toBe(3600);
    expect(state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === 101).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 101, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: attacker.uid, value: 3600 },
    ]);
    expect(state.eventHistory.filter((event) => ["specialSummoned", "breakEffect", "confirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: varefar.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: varefar.uid,
        eventReasonEffectId: 2,
        eventUids: [varefar.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: varefar.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: revealSpell.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventUids: [revealSpell.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: varefar.uid,
        eventReasonEffectId: 2,
      },
    ]);

    finishRestoredBattle(restored);
    expect(restored.session.state.battleDamage).toEqual({ 0: 2600, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1a:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_POSITION+CATEGORY_ATKCHANGE+CATEGORY_REMOVE)");
  expect(script).toContain("e1a:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1a:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1a:SetCode(EVENT_CHAINING)");
  expect(script).toContain("rp==1-tp and re:IsMonsterEffect() and re:IsHasProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("local e1b=e1a:Clone()");
  expect(script).toContain("e1b:SetCode(EVENT_BE_BATTLE_TARGET)");
  expect(script).toContain("local at=Duel.GetAttacker()");
  expect(script).toContain("local bt=Duel.GetAttackTarget()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("Duel.CheckEvent(EVENT_BE_BATTLE_TARGET) and Duel.GetAttacker()");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,opp_mon,1,tp,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,opp_mon,1,tp,opp_mon:GetAttack())");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_REMOVE,opp_mon,1,tp,0)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.revealfilter,tp,LOCATION_HAND,0,1,1,nil,types):GetFirst()");
  expect(script).toContain("Duel.ConfirmCards(1-tp,rc)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("Duel.ChangePosition(opp_mon,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
  expect(script).toContain("e1:SetValue(opp_mon:GetAttack()*2)");
  expect(script).toContain("Duel.Remove(opp_mon,POS_FACEUP,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: varefarCode, name: "VARefar, the Judge of Ball", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 11, attack: 2100, defense: 800 },
    { code: revealSpellCode, name: "VARefar Reveal Spell", kind: "spell", typeFlags: typeSpell },
    { code: targetCode, name: "VARefar Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "VARefar Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const actions = getLuaRestoreLegalActions(restored, player);
    const pass = actions.find((action) => action.type === passType);
    if (!pass) {
      const replay = actions.find((action) => action.type === "replayAttack");
      if (replay) {
        applyRestoredActionAndAssert(restored, replay);
        continue;
      }
    }
    expect(pass, JSON.stringify(actions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
