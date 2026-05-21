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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const gryphonCode = "28406301";
const targetCode = "284063010";
const contractOneCode = "284063011";
const contractTwoCode = "284063012";
const offSetContractCode = "284063013";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const setDarkContract = 0xae;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D/D Gryphon PZone contract stat destroy", () => {
  it("restores PZone Dark Contract name-count targeting into Fiend ATK gain and self destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gryphonCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsSetCard(SET_DARK_CONTRACT) and c:IsSpellTrap() and c:IsFaceup()");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_FIEND),tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetValue(g:GetClassCount(Card.GetCode)*500)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gryphonCode),
      { code: targetCode, name: "D/D Gryphon Fiend Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1200, defense: 1000 },
      { code: contractOneCode, name: "Dark Contract One", kind: "spell", typeFlags: typeSpell, setcodes: [setDarkContract] },
      { code: contractTwoCode, name: "Dark Contract Two", kind: "spell", typeFlags: typeSpell, setcodes: [setDarkContract] },
      { code: offSetContractCode, name: "Off-Set Face-Up Spell", kind: "spell", typeFlags: typeSpell, setcodes: [0x123] },
      { code: `${contractOneCode}0`, name: "D/D Gryphon Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28406301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gryphonCode, targetCode, contractOneCode, contractTwoCode, offSetContractCode, `${contractOneCode}0`] }, 1: { main: [] } });
    startDuel(session);

    const gryphon = requireCard(session, gryphonCode);
    const target = requireCard(session, targetCode);
    const contractOne = requireCard(session, contractOneCode);
    const contractTwo = requireCard(session, contractTwoCode);
    const offSetContract = requireCard(session, offSetContractCode);
    const warriorDecoy = requireCard(session, `${contractOneCode}0`);
    moveDuelCard(session.state, gryphon.uid, "spellTrapZone", 0);
    gryphon.sequence = 0;
    gryphon.faceUp = true;
    gryphon.position = "faceUpAttack";
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, warriorDecoy, 0);
    moveFaceUpSpell(session, contractOne, 0, 2);
    moveDuelCard(session.state, contractTwo.uid, "graveyard", 0);
    contractTwo.faceUp = true;
    moveFaceUpSpell(session, offSetContract, 0, 3);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gryphonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gryphon.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toHaveLength(0);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === gryphon.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: gryphon.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(2200);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === warriorDecoy.uid), restoredResolved.session.state)).toBe(2000);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, value: 1000 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventChainLinkId: event.eventChainLinkId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      {
        eventName: "becameTarget",
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
      {
        eventName: "destroyed",
        eventCardUid: gryphon.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: gryphon.uid,
        eventReasonEffectId: 3,
        eventChainLinkId: undefined,
        relatedEffectId: undefined,
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
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
