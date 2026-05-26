import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const piecephiliaCode = "49776811";
const attackerCode = "990497681";
const deckMonsterCode = "990497682";
const deckFillerCode = "990497683";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPiecephiliaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${piecephiliaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const counterPiece = 0x20a;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPiecephiliaScript)("Lua real script Shining Piecephilia counter decktop", () => {
  it("restores damage-step-end counter gain into optional monster decktop confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${piecephiliaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restored = createRestoredBattleState(reader, workspace);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);

    const piecephilia = requireCard(restored.session, piecephiliaCode);
    const attacker = requireCard(restored.session, attackerCode);
    attackAndReachDamageEnd(restored, 1, attacker.uid, piecephilia.uid);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === piecephilia.uid && action.effectId?.endsWith("-1141")
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, trigger!);
    resolveRestoredChain(restored);

    const restoredPiecephilia = findCard(restored.session, piecephilia.uid);
    const deckMonster = requireCard(restored.session, deckMonsterCode);
    expect(getDuelCardCounter(restoredPiecephilia, counterPiece)).toBe(1);
    expect(restoredPiecephilia).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(findCard(restored.session, deckMonster.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.host.promptDecisions.filter((prompt) => ["SelectYesNo", "SelectMatchingCard"].includes(prompt.api)).map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: "returned" in prompt ? prompt.returned : undefined,
      selected: "selected" in prompt ? prompt.selected : undefined,
    }))).toEqual([
      { api: "SelectYesNo", player: 0, returned: true, selected: undefined },
    ]);
    expect(restored.host.messages).toContain(`confirmed decktop 0: ${deckMonsterCode}`);
    expect(restored.session.state.eventHistory.filter((event) => ["damageStepEnded", "counterAdded", "breakEffect", "confirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: attacker.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: [attacker.uid, piecephilia.uid] },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: piecephilia.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: piecephilia.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: piecephilia.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: deckMonster.uid, eventPlayer: 0, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: [deckMonster.uid] },
    ]);
  });
});

function createRestoredBattleState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 49776811, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [piecephiliaCode, deckMonsterCode, deckFillerCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, piecephiliaCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  setDeckSequence(requireCard(session, deckMonsterCode), 0);
  setDeckSequence(requireCard(session, deckFillerCode), 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerPiecephilia(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const piecephilia = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === piecephiliaCode);
  expect(piecephilia).toBeDefined();
  return [
    piecephilia!,
    { code: attackerCode, name: "Shining Piecephilia Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 3000, defense: 1000 },
    { code: deckMonsterCode, name: "Shining Piecephilia Deck Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: deckFillerCode, name: "Shining Piecephilia Deck Filler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
  ];
}

function registerPiecephilia(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
  expect(host.loadCardScript(Number(piecephiliaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Shining Piecephilia");
  expect(script).toContain("c:EnableCounterPermit(0x20a)");
  expect(script).toContain("c:SetCounterLimit(0x20a,4)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER+CATEGORY_DRAW+CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("c:IsStatus(STATUS_OPPO_BATTLE)");
  expect(script).toContain("c:AddCounter(0x20a,1)");
  expect(script).toContain("if ct==1 and Duel.IsExistingMatchingCard(Card.IsMonster,tp,LOCATION_DECK,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsMonster,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.ShuffleDeck(tp)");
  expect(script).toContain("Duel.MoveSequence(tc,0)");
  expect(script).toContain("Duel.ConfirmDecktop(tp,1)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.location = "deck";
  card.controller = card.owner;
  card.sequence = sequence;
  card.faceUp = false;
}

function attackAndReachDamageEnd(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  let guard = 0;
  while (restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const currentPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, currentPlayer).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, currentPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
