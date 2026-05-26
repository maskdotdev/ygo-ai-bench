import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const crimeCode = "69058960";
const punishmentCode = "95442074";
const hasCrimeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crimeCode}.lua`));
const hasPunishmentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${punishmentCode}.lua`));
const typeMonster = 0x1;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasCrimeScript || !hasPunishmentScript)("Lua real script Number 13 must-attack reflect", () => {
  it("restores detach-cost group position change, temporary must-attack target locks, and GetAttackTarget reflect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const materialCode = "690589600";
    const secondMaterialCode = "690589602";
    const forcedAttackerCode = "690589601";
    const script = workspace.readScript(`official/c${crimeCode}.lua`);
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("Duel.ChangePosition(g,POS_FACEUP_ATTACK)");
    expect(script).toContain("e1:SetCode(EFFECT_MUST_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_MUST_ATTACK_MONSTER)");
    expect(script).toContain("e2:SetValue(s.atklimit)");
    expect(script).toContain("e2:SetLabel(fid)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e4:SetCode(EFFECT_REFLECT_BATTLE_DAMAGE)");
    expect(script).toContain("Duel.GetAttackTarget()==e:GetHandler()");

    const cards: DuelCardData[] = [
      { code: crimeCode, name: "Number 13: Embodiment of Crime", kind: "extra", typeFlags: typeMonster | typeXyz, level: 1, attack: 500, defense: 500 },
      { code: punishmentCode, name: "Number 31: Embodiment of Punishment", kind: "extra", typeFlags: typeMonster | typeXyz, level: 1, attack: 500, defense: 500 },
      { code: materialCode, name: "Number 13 Overlay Material", kind: "monster", typeFlags: typeMonster, level: 1, attack: 100, defense: 100 },
      { code: secondMaterialCode, name: "Number 13 Second Overlay Material", kind: "monster", typeFlags: typeMonster, level: 1, attack: 100, defense: 100 },
      { code: forcedAttackerCode, name: "Number 13 Forced Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 69058960, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, secondMaterialCode], extra: [crimeCode, punishmentCode] }, 1: { main: [forcedAttackerCode] } });
    startDuel(session);

    const crime = requireCard(session, crimeCode);
    const punishment = requireCard(session, punishmentCode);
    const material = requireCard(session, materialCode);
    const secondMaterial = requireCard(session, secondMaterialCode);
    const forcedAttacker = requireCard(session, forcedAttackerCode);
    moveDuelCard(session.state, crime.uid, "monsterZone", 0);
    crime.position = "faceUpAttack";
    crime.faceUp = true;
    moveDuelCard(session.state, punishment.uid, "monsterZone", 0);
    punishment.position = "faceUpAttack";
    punishment.faceUp = true;
    moveDuelCard(session.state, material.uid, "overlay", 0);
    moveDuelCard(session.state, secondMaterial.uid, "overlay", 0);
    crime.overlayUids.push(material.uid, secondMaterial.uid);
    moveDuelCard(session.state, forcedAttacker.uid, "monsterZone", 1);
    forcedAttacker.position = "faceUpDefense";
    forcedAttacker.faceUp = true;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crimeCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(punishmentCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === crime.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
    });
    expect(session.state.cards.find((card) => card.uid === crime.uid)?.overlayUids).toEqual([secondMaterial.uid]);
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredChain);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));

    expect(restoredChain.session.state.cards.find((card) => card.uid === forcedAttacker.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === crime.uid)?.overlayUids).toEqual([secondMaterial.uid]);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === forcedAttacker.uid && [191, 344].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "code": 191,
          "controller": 1,
          "event": "continuous",
          "id": "lua-11-191",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:69058960:lua-11-191",
          "reset": {
            "flags": 1107169792,
          },
          "sourceUid": "p1-deck-690589601-0",
        },
        {
          "code": 344,
          "controller": 1,
          "event": "continuous",
          "id": "lua-12-344",
          "label": 6,
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:69058960:lua-12-344",
          "reset": {
            "flags": 1107169792,
          },
          "sourceUid": "p1-deck-690589601-0",
          "valueCardPredicate": [Function],
        },
      ]
    `);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: forcedAttacker.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: crime.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const battle = getLegalActions(restoredChain.session, 1).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(restoredChain.session, battle!);
    const battleActions = getLegalActions(restoredChain.session, 1);
    expect(hasAttack(battleActions, forcedAttacker.uid, crime.uid)).toBe(true);
    expect(hasAttack(battleActions, forcedAttacker.uid, punishment.uid)).toBe(false);

    const attack = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === forcedAttacker.uid && action.targetUid === crime.uid);
    expect(attack).toBeDefined();
    applyAndAssert(restoredChain.session, attack!);
    passBattleResponses(restoredChain.session);
    expect(restoredChain.session.state.cards.find((card) => card.uid === crime.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });
    expect(restoredChain.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: crime.uid,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.battle,
        eventReasonCardUid: crime.uid,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}
