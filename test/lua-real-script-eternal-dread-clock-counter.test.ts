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
const eternalDreadCode = "35787450";
const clockTowerCode = "75041269";
const decoyFieldCode = "357874500";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEternalDreadScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${eternalDreadCode}.lua`));
const hasClockTowerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clockTowerCode}.lua`));
const clockCounter = 0x1b;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasEternalDreadScript || !hasClockTowerScript)("Lua real script Eternal Dread clock counter", () => {
  it("restores Field Zone lookup adding two Clock Counters to each face-up Clock Tower Prison", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${eternalDreadCode}.lua`), workspace.readScript(`official/c${clockTowerCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredOpen({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const dread = requireCard(restoredOpen.session, eternalDreadCode);
    const ownClockTower = requireControlledCard(restoredOpen.session, clockTowerCode, 0);
    const opponentClockTower = requireControlledCard(restoredOpen.session, clockTowerCode, 1);
    const decoyField = requireCard(restoredOpen.session, decoyFieldCode);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dread.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, dread.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(getDuelCardCounter(findCard(restoredOpen.session, ownClockTower.uid), clockCounter)).toBe(2);
    expect(getDuelCardCounter(findCard(restoredOpen.session, opponentClockTower.uid), clockCounter)).toBe(2);
    expect(getDuelCardCounter(findCard(restoredOpen.session, decoyField.uid), clockCounter)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["counterAdded", "sentToGraveyard"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: ownClockTower.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: dread.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: opponentClockTower.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: dread.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: dread.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: eternalDreadCode, name: "Eternal Dread", kind: "trap", typeFlags: typeTrap },
    { code: clockTowerCode, name: "Clock Tower Prison", kind: "spell", typeFlags: typeSpell | typeField },
    { code: decoyFieldCode, name: "Eternal Dread Decoy Field", kind: "spell", typeFlags: typeSpell | typeField },
  ];
}

function createRestoredOpen({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 35787450, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [eternalDreadCode, clockTowerCode, decoyFieldCode] }, 1: { main: [clockTowerCode] } });
  startDuel(session);
  moveFaceDownTrap(session, requireCard(session, eternalDreadCode), 0, 1);
  moveFaceUpSpellTrap(session, requireControlledCard(session, clockTowerCode, 0), 0, 0);
  moveFaceUpSpellTrap(session, requireControlledCard(session, clockTowerCode, 1), 1, 0);
  moveFaceUpSpellTrap(session, requireCard(session, decoyFieldCode), 0, 1);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  for (const code of [eternalDreadCode, clockTowerCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

type ScriptSource = { readScript(name: string): string | undefined };

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${decoyFieldCode}.lua`) return decoyFieldScript();
      return workspace.readScript(name);
    },
  };
}

function decoyFieldScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(0x1b)
    end
  `;
}

function expectScriptShape(eternalDreadScript: string | undefined, clockTowerScript: string | undefined): void {
  expect(eternalDreadScript).toBeDefined();
  expect(clockTowerScript).toBeDefined();
  if (!eternalDreadScript || !clockTowerScript) return;
  expect(eternalDreadScript).toContain("--Eternal Dread");
  expect(eternalDreadScript).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(eternalDreadScript).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(eternalDreadScript).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(eternalDreadScript).toContain("Duel.GetFieldCard(tp,LOCATION_FZONE,0)");
  expect(eternalDreadScript).toContain("return tc and tc:IsFaceup() and tc:IsCode(75041269)");
  expect(eternalDreadScript).toContain("Duel.GetFieldCard(1-tp,LOCATION_FZONE,0)");
  expect(eternalDreadScript).toContain("tc:AddCounter(0x1b,2)");
  expect(clockTowerScript).toContain("c:EnableCounterPermit(0x1b)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireControlledCard(session: DuelSession, code: string, controller: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.controller === controller);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function slimEvent(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
  return {
    eventCardUid: event.eventCardUid,
    eventCode: event.eventCode,
    eventName: event.eventName,
    eventReason: event.eventReason,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventReasonPlayer: event.eventReasonPlayer,
  };
}
