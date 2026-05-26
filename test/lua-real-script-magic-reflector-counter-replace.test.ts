import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const magicReflectorCode = "61844784";
const targetSpellCode = "618447840";
const decoySpellCode = "618447841";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMagicReflectorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magicReflectorCode}.lua`));
const typeSpell = 0x2;
const counterGuard = 0x102a;

describe.skipIf(!hasUpstreamScripts || !hasMagicReflectorScript)("Lua real script Magic Reflector counter replace", () => {
  it("restores Guard Counter placement and target Spell destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${magicReflectorCode}.lua`));
    const reader = createCardReader(cards());
    const restored = createRestoredField(reader, workspace);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const reflector = requireCard(restored.session, magicReflectorCode);
    const targetSpell = requireCard(restored.session, targetSpellCode);
    const decoySpell = requireCard(restored.session, decoySpellCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === reflector.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, reflector.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(getDuelCardCounter(findCard(restored.session, targetSpell.uid), counterGuard)).toBe(1);
    expect(getDuelCardCounter(findCard(restored.session, decoySpell.uid), counterGuard)).toBe(0);
    const replacement = restored.session.state.effects.find((effect) =>
      effect.sourceUid === targetSpell.uid && effect.event === "continuous" && effect.code === 50
    );
    expect(replacement).toMatchObject({
      sourceUid: targetSpell.uid,
      event: "continuous",
      code: 50,
      reset: { flags: 33427456 },
    });
    expect(restored.session.state.eventHistory.filter((event) => ["counterAdded", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterAdded", eventCardUid: targetSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: reflector.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCardUid: reflector.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const eventStart = restored.session.state.eventHistory.length;
    destroyDuelCard(restored.session.state, targetSpell.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(findCard(restored.session, targetSpell.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(getDuelCardCounter(findCard(restored.session, targetSpell.uid), counterGuard)).toBe(0);
    expect(restored.session.state.eventHistory.slice(eventStart).filter((event) => ["counterRemoved", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCardUid: targetSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: targetSpell.uid, eventReasonEffectId: 2 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: magicReflectorCode, name: "Magic Reflector", kind: "spell", typeFlags: typeSpell },
    { code: targetSpellCode, name: "Magic Reflector Target Spell", kind: "spell", typeFlags: typeSpell },
    { code: decoySpellCode, name: "Magic Reflector Decoy Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function createRestoredField(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 61844784, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [magicReflectorCode, targetSpellCode, decoySpellCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, magicReflectorCode).uid, "hand", 0);
  moveFaceUpSpell(session, requireCard(session, targetSpellCode), 0, 0);
  moveFaceUpSpell(session, requireCard(session, decoySpellCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerMagicReflector(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerMagicReflector(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(magicReflectorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Magic Reflector");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_SZONE,0,1,e:GetHandler())");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_SZONE,0,1,1,e:GetHandler())");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("tc:AddCounter(0x102a,1)");
  expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("e:GetHandler():GetCounter(0x102a)>0");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x102a,1,REASON_EFFECT)");
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.sequence = sequence;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
