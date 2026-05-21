import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const verreCode = "21522601";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVerreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${verreCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasVerreScript)("Lua real script Witchcrafter Madame Verre battle reveal stat", () => {
  it("restores battle monster lookup into hand Spell reveal count ATK/DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const opponentCode = "215226010";
    const spellOneCode = "215226011";
    const spellTwoCode = "215226012";
    const script = workspace.readScript(`official/c${verreCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("local tc,bc=Duel.GetBattleMonster(tp)");
    expect(script).toContain("tc:IsRace(RACE_SPELLCASTER)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.rvfilt,tp,LOCATION_HAND,0,1,nil)");
    expect(script).toContain("Duel.GetMatchingGroup(s.rvfilt,tp,LOCATION_HAND,0,nil)");
    expect(script).toContain("sg:GetClassCount(Card.GetCode)");
    expect(script).toContain("aux.SelectUnselectGroup(sg,e,tp,1,ct,aux.dncheck,1,tp,HINTMSG_CONFIRM)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.ShuffleHand(tp)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(#g*1000)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsNegatableMonster,tp,0,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsNegatableMonster,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("tc:NegateEffects(c,RESET_PHASE|PHASE_END)");

    const cards: DuelCardData[] = [
      { code: verreCode, name: "Witchcrafter Madame Verre", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, level: 8, attack: 1000, defense: 2800 },
      { code: opponentCode, name: "Verre Battle Opponent", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: spellOneCode, name: "Verre Reveal Spell One", kind: "spell", typeFlags: typeSpell },
      { code: spellTwoCode, name: "Verre Reveal Spell Two", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21522601, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [verreCode, spellOneCode, spellTwoCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const verre = requireCard(session, verreCode);
    const opponent = requireCard(session, opponentCode);
    const spellOne = requireCard(session, spellOneCode);
    const spellTwo = requireCard(session, spellTwoCode);
    moveFaceUpAttack(session, verre, 0);
    moveFaceUpAttack(session, opponent, 1);
    moveDuelCard(session.state, spellOne.uid, "hand", 0);
    moveDuelCard(session.state, spellTwo.uid, "hand", 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(verreCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === verre.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilDamageCalculationResponse(session, 0);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, restored.session.state.waitingFor ?? 0);
    const restoredActions = [
      ...getLuaRestoreLegalActions(restored, 0),
      ...getLuaRestoreLegalActions(restored, 1),
    ];
    const statAction = restoredActions.find((action) => action.type === "activateEffect" && action.uid === verre.uid && action.effectId === "lua-1-1134");
    expect(statAction, JSON.stringify({
      waitingFor: restored.session.state.waitingFor,
      battleStep: restored.session.state.battleStep,
      battleWindow: restored.session.state.battleWindow,
      p0: getLuaRestoreLegalActions(restored, 0),
      p1: getLuaRestoreLegalActions(restored, 1),
    }, null, 2)).toBeDefined();
    expect(statAction).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restored, statAction!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === verre.uid), restored.session.state)).toBe(2000);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === verre.uid), restored.session.state)).toBe(3800);
    expect(restored.host.messages).toEqual([`confirmed 1: ${spellOneCode}`]);
    expect(restored.session.state.cards.find((card) => card.uid === spellOne.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === spellTwo.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: verre.uid,
        eventUids: [verre.uid, opponent.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

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

function passUntilDamageCalculationResponse(session: DuelSession, player: PlayerId): void {
  let guard = 0;
  while (session.state.pendingBattle && (session.state.battleWindow?.kind !== "beforeDamageCalculation" || session.state.waitingFor !== player)) {
    expect(++guard).toBeLessThan(10);
    passBattleResponse(session);
  }
}

function passBattleResponse(session: DuelSession): void {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLegalActions(session, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
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
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
