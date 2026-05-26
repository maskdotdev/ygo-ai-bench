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
const rhynosaberCode = "82197831";
const discardCode = "821978310";
const graveLevel3Code = "821978311";
const graveLevel4Code = "821978312";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRhynosaberScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rhynosaberCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceMachine = 0x2000;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasRhynosaberScript)("Lua real script Rhynosaber discard attack stat", () => {
  it("restores discard cost count into self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rhynosaberCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = createRestoredRhynosaberOpen({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const rhynosaber = requireCard(restored.session, rhynosaberCode);
    const discard = requireCard(restored.session, discardCode);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === rhynosaber.uid && candidate.effectId === "lua-3"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: rhynosaber.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === rhynosaber.uid), restored.session.state)).toBe(3100);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rhynosaber.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: rhynosaber.uid, targetRange: undefined, value: 700 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === discard.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: rhynosaber.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 2 },
      },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rhynosaberCode, name: "Rampaging Smashtank Rhynosaber", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceMachine, attribute: attributeEarth, level: 7, attack: 2400, defense: 2100 },
    { code: discardCode, name: "Rhynosaber Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 5, attack: 1500, defense: 1000 },
    { code: graveLevel3Code, name: "Rhynosaber Grave Level 3", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 3, attack: 1000, defense: 1000 },
    { code: graveLevel4Code, name: "Rhynosaber Grave Level 4", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1300, defense: 1000 },
  ];
}

function createRestoredRhynosaberOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82197831, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [discardCode, graveLevel3Code, graveLevel4Code], extra: [rhynosaberCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, rhynosaberCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, graveLevel3Code).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, graveLevel4Code).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rhynosaberCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Rampaging Smashtank Rhynosaber");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,60,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(700*ct)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("e2:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("g:CheckWithSumEqual(Card.GetLevel,7,1,ct)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
