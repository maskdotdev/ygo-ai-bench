import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const armageddonCode = "47198668";
const destroyedCode = "471986680";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasArmageddonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${armageddonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setDd = 0xaf;
const effectCannotDirectAttack = 73;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasArmageddonScript)("Lua real script Doom King Armageddon destroyed stat", () => {
  it("restores destroyed-monster targeting into self ATK gain and direct-attack oath lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${armageddonCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 47198668, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [armageddonCode, destroyedCode] }, 1: { main: [] } });
    startDuel(session);

    const armageddon = requireCard(session, armageddonCode);
    const destroyed = requireCard(session, destroyedCode);
    moveFaceUpAttack(session, armageddon, 0);
    moveFaceUpAttack(session, destroyed, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(armageddonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, destroyed.uid, 0, duelReason.effect | duelReason.destroy, 0);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === armageddon.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-4-1029",
        eventCardUid: destroyed.uid,
        eventCode: 1029,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "destroyed",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: armageddon.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === armageddon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === armageddon.uid), restoredResolved.session.state)).toBe(4800);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === armageddon.uid && [effectCannotDirectAttack, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotDirectAttack, description: 3207, property: 67634176, reset: { flags: 1107169792 }, sourceUid: armageddon.uid, value: undefined },
      { code: effectUpdateAttack, description: undefined, property: undefined, reset: { flags: 1107235328 }, sourceUid: armageddon.uid, value: 1800 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: armageddonCode, name: "D/D/D Doom King Armageddon", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceFiend, attribute: attributeDark, setcodes: [setDd], level: 8, attack: 3000, defense: 1000, leftScale: 4, rightScale: 4 },
    { code: destroyedCode, name: "Doom King Armageddon Destroyed D/D", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setDd], level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--D/D/D Doom King Armageddon");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return c:IsReason(REASON_BATTLE|REASON_EFFECT) and c:IsMonster()");
  expect(script).toContain("Duel.SetTargetCard(g)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("e1:SetDescription(3207)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetBaseAttack())");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
}

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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
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
