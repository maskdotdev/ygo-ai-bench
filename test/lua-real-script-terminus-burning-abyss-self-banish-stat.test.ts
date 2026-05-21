import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const terminusCode = "44771289";
const burningAbyssTargetCode = "447712890";
const offSetDecoyCode = "447712891";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTerminusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${terminusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setBurningAbyss = 0xb1;

describe.skipIf(!hasUpstreamScripts || !hasTerminusScript)("Lua real script Terminus Burning Abyss self-banish stat", () => {
  it("restores aux.exccon grave self-banish into targeted Burning Abyss ATK/DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${terminusCode}.lua`);
    expect(script).toContain("Fusion.CreateSummonEff(c,aux.FilterBoolFunction(Card.IsSetCard,SET_BURNING_ABYSS))");
    expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e2:SetCondition(aux.exccon)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_BURNING_ABYSS)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN)");

    const cards: DuelCardData[] = [
      { code: terminusCode, name: "The Terminus of the Burning Abyss", kind: "spell", typeFlags: typeSpell },
      { code: burningAbyssTargetCode, name: "Terminus Burning Abyss Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBurningAbyss], level: 3, attack: 1200, defense: 900 },
      { code: offSetDecoyCode, name: "Terminus Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 1800, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 44771289, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [terminusCode, burningAbyssTargetCode, offSetDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const terminus = requireCard(session, terminusCode);
    const target = requireCard(session, burningAbyssTargetCode);
    const decoy = requireCard(session, offSetDecoyCode);
    moveDuelCard(session.state, terminus.uid, "graveyard", 0);
    terminus.faceUp = true;
    terminus.turnId = 0;
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, decoy, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(terminusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === terminus.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === terminus.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: terminus.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!, restoredOpen.session.state)).toBe(2000);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!, restoredOpen.session.state)).toBe(1700);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)!, restoredOpen.session.state)).toBe(1800);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)!, restoredOpen.session.state)).toBe(1600);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, controller: 0, event: "continuous", range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: target.uid, value: 800 },
      { code: 104, controller: 0, event: "continuous", range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: target.uid, value: 800 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "becameTarget")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: terminus.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: terminus.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
  });
});

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
