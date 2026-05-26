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
const gustaphCode = "47829960";
const firstSpellCode = "478299600";
const secondSpellCode = "478299601";
const trapDecoyCode = "478299602";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGustaphScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gustaphCode}.lua`));
const typeSpell = 0x2;
const typeTrap = 0x4;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGustaphScript)("Lua real script Chaosrider Gustaph grave spell banish attack stat", () => {
  it("restores up-to-two grave Spell banish into removed-count ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gustaphCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredGustaphField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const gustaph = requireCard(restored.session, gustaphCode);
    const firstSpell = requireCard(restored.session, firstSpellCode);
    const secondSpell = requireCard(restored.session, secondSpellCode);
    const trapDecoy = requireCard(restored.session, trapDecoyCode);

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === gustaph.uid && candidate.effectId === "lua-1"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    for (const spell of [firstSpell, secondSpell]) {
      expect(restored.session.state.cards.find((card) => card.uid === spell.uid)).toMatchObject({
        location: "banished",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: gustaph.uid,
        reasonEffectId: 1,
      });
    }
    expect(restored.session.state.cards.find((card) => card.uid === trapDecoy.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === gustaph.uid), restored.session.state)).toBe(2000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gustaph.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1644106240 }, sourceUid: gustaph.uid, value: 600 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventCardUid: firstSpell.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: gustaph.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: secondSpell.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: gustaph.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: firstSpell.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: gustaph.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventUids: [firstSpell.uid, secondSpell.uid] },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredGustaphField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 47829960, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gustaphCode, firstSpellCode, secondSpellCode, trapDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, gustaphCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, firstSpellCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, secondSpellCode), 0, 1);
  moveFaceUpGrave(session, requireCard(session, trapDecoyCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gustaphCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Chaosrider Gustaph");
  expect(script).toContain("CATEGORY_REMOVE+CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_TYPE_IGNITION");
  expect(script).toContain("return c:IsSpell() and c:IsAbleToRemove()");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.rmfilter,tp,LOCATION_GRAVE,0,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,1-tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmfilter,tp,LOCATION_GRAVE,0,1,2,nil)");
  expect(script).toContain("Duel.HintSelection(g,true)");
  expect(script).toContain("local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("e1:SetValue(ct*300)");
  expect(script).toContain("RESETS_STANDARD_DISABLE_PHASE_END|RESET_OPPO_TURN");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const gustaph = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gustaphCode);
  expect(gustaph).toBeDefined();
  return [
    gustaph!,
    { code: firstSpellCode, name: "Chaosrider Gustaph First Spell", kind: "spell", typeFlags: typeSpell },
    { code: secondSpellCode, name: "Chaosrider Gustaph Second Spell", kind: "spell", typeFlags: typeSpell },
    { code: trapDecoyCode, name: "Chaosrider Gustaph Trap Decoy", kind: "trap", typeFlags: typeTrap },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
