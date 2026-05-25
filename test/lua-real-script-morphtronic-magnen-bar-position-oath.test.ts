import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const magnenBarCode = "45593005";
const allyOneCode = "455930050";
const allyTwoCode = "455930051";
const defenderCode = "455930052";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMagnenBarScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magnenBarCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const effectCannotAttack = 85;
const resetStandardDisablePhaseEnd = 1107235328;
const resetPhaseEnd = 1073742336;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMagnenBarScript)("Lua real script Morphtronic Magnen Bar position oath", () => {
  it("restores exact two-ally ATK sum and attack-only oath from attack position", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${magnenBarCode}.lua`);
    expect(script).toContain("--Morphtronic Magnen Bar");
    expect(script).toContain("return not e:GetHandler():IsDisabled() and e:GetHandler():IsAttackPos()");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.cfilter,tp,LOCATION_MZONE,0,e:GetHandler())==2");
    expect(script).toContain("not Duel.IsExistingMatchingCard(Card.IsDefensePos,tp,LOCATION_MZONE,0,1,e:GetHandler())");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_OATH)");
    expect(script).toContain("e1:SetLabel(c:GetFieldID())");
    expect(script).toContain("return e:GetLabel()~=c:GetFieldID()");
    expect(script).toContain("local sg=g:Filter(s.filter,nil,e)");
    expect(script).toContain("local atk=sg:GetSum(Card.GetAttack)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");

    const magnenBarData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === magnenBarCode);
    expect(magnenBarData).toBeDefined();
    const reader = createCardReader([
      magnenBarData!,
      { code: allyOneCode, name: "Magnen Bar Ally One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 700, defense: 1000 },
      { code: allyTwoCode, name: "Magnen Bar Ally Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1100, defense: 1000 },
      { code: defenderCode, name: "Magnen Bar Opponent Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    ] satisfies DuelCardData[]);
    const session = createDuel({ seed: 45593005, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magnenBarCode, allyOneCode, allyTwoCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const magnenBar = requireCard(session, magnenBarCode);
    const allyOne = requireCard(session, allyOneCode);
    const allyTwo = requireCard(session, allyTwoCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, magnenBar, 0, 0);
    moveFaceUpAttack(session, allyOne, 0, 1);
    moveFaceUpAttack(session, allyTwo, 0, 2);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magnenBarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === magnenBar.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(findCard(restoredOpen.session, magnenBar.uid), restoredOpen.session.state)).toBe((magnenBarData!.attack ?? 0) + 1800);
    expect(currentAttack(findCard(restoredOpen.session, allyOne.uid), restoredOpen.session.state)).toBe(700);
    expect(currentAttack(findCard(restoredOpen.session, allyTwo.uid), restoredOpen.session.state)).toBe(1100);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === magnenBar.uid && [effectUpdateAttack, effectCannotAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotAttack, event: "continuous", label: undefined, reset: undefined, targetRange: [4, 0], value: undefined },
      { code: effectCannotAttack, event: "continuous", label: magnenBar.fieldId, reset: { flags: resetPhaseEnd }, targetRange: [4, 0], value: undefined },
      { code: effectUpdateAttack, event: "continuous", label: undefined, reset: { flags: resetStandardDisablePhaseEnd }, targetRange: undefined, value: 1800 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCardUid: allyOne.uid,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCardUid: allyTwo.uid,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);

    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.waitingFor = 0;
    const battleProbe = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(battleProbe);
    expectRestoredLegalActions(battleProbe, 0);
    const battleActions = getLuaRestoreLegalActions(battleProbe, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === magnenBar.uid && action.targetUid === defender.uid)).toBe(true);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === allyOne.uid)).toBe(false);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === allyTwo.uid)).toBe(false);
  });

  it("restores defense-position continuous lock on all own monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const magnenBarData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === magnenBarCode);
    expect(magnenBarData).toBeDefined();
    const reader = createCardReader([
      magnenBarData!,
      { code: allyOneCode, name: "Magnen Bar Defense-Locked Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
      { code: defenderCode, name: "Magnen Bar Defense-Lock Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    ] satisfies DuelCardData[]);
    const session = createDuel({ seed: 45593006, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magnenBarCode, allyOneCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const magnenBar = requireCard(session, magnenBarCode);
    const ally = requireCard(session, allyOneCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpDefense(session, magnenBar, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magnenBarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    expect(battleActions.filter((action) => action.type === "declareAttack")).toEqual([]);
  });
});

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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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
