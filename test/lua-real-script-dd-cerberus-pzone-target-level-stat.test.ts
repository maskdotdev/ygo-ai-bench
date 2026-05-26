import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cerberusCode = "39153655";
const ddTargetCode = "391536550";
const ddLevel4DecoyCode = "391536551";
const offSetDecoyCode = "391536552";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCerberusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cerberusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setDd = 0xaf;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasCerberusScript)("Lua real script D/D Cerberus PZONE target level stat", () => {
  it("restores PZONE ignition targeting a D/D monster into level 4 plus ATK/DEF boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cerberusCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 39153655, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cerberusCode, ddTargetCode, ddLevel4DecoyCode, offSetDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const cerberus = requireCard(session, cerberusCode);
    const ddTarget = requireCard(session, ddTargetCode);
    const ddLevel4Decoy = requireCard(session, ddLevel4DecoyCode);
    const offSetDecoy = requireCard(session, offSetDecoyCode);
    moveFaceUpPzone(session, cerberus, 0, 0);
    moveFaceUpAttack(session, ddTarget, 0, 0);
    moveFaceUpAttack(session, ddLevel4Decoy, 0, 1);
    moveFaceUpAttack(session, offSetDecoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cerberusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentLevel(ddTarget, session.state)).toBe(3);
    expect(currentAttack(ddTarget, session.state)).toBe(1200);
    expect(currentDefense(ddTarget, session.state)).toBe(900);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === cerberus.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, ignition!);

    expect(restoredOpen.host.promptDecisions).toEqual([]);
    expect(restoredOpen.session.state.chain).toEqual([]);
    const restoredTarget = findCard(restoredOpen.session, ddTarget.uid);
    expect(currentLevel(restoredTarget, restoredOpen.session.state)).toBe(4);
    expect(currentAttack(restoredTarget, restoredOpen.session.state)).toBe(1600);
    expect(currentDefense(restoredTarget, restoredOpen.session.state)).toBe(1300);
    expect(currentLevel(findCard(restoredOpen.session, ddLevel4Decoy.uid), restoredOpen.session.state)).toBe(4);
    expect(currentAttack(findCard(restoredOpen.session, offSetDecoy.uid), restoredOpen.session.state)).toBe(1000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ddTarget.uid && [effectChangeLevel, effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, property: 0x400, reset: { flags: 33427456 }, sourceUid: ddTarget.uid, value: 4 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: ddTarget.uid, value: 400 },
      { code: effectUpdateDefense, property: 0x400, reset: { flags: 33427456 }, sourceUid: ddTarget.uid, value: 400 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: ddTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const persistentTarget = findCard(restoredStat.session, ddTarget.uid);
    expect(currentLevel(persistentTarget, restoredStat.session.state)).toBe(4);
    expect(currentAttack(persistentTarget, restoredStat.session.state)).toBe(1600);
    expect(currentDefense(persistentTarget, restoredStat.session.state)).toBe(1300);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: cerberusCode, name: "D/D Cerberus", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 600, leftScale: 6, rightScale: 6, setcodes: [setDd] },
    { code: ddTargetCode, name: "D/D Cerberus Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 3, attack: 1200, defense: 900, setcodes: [setDd] },
    { code: ddLevel4DecoyCode, name: "D/D Cerberus Level 4 Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1400, defense: 1000, setcodes: [setDd] },
    { code: offSetDecoyCode, name: "Cerberus Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 3, attack: 1000, defense: 1000, setcodes: [0x123] },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--D/D Cerberus");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e2:SetRange(LOCATION_PZONE)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_DD) and lv>0 and lv~=4");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e1:SetValue(4)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(400)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpPzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
