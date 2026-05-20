import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ashenedCode = "66848311";
const ownedTargetCode = "668483111";
const opponentFaceupCode = "668483112";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ashened for Eternity owned control", () => {
  it("restores owned-opponent monster control and optional opponent ATK drain after the control change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ashenedCode}.lua`);
    expect(script).toContain("Duel.SelectTarget(tp,s.ctrlfilter,tp,0,LOCATION_MZONE,1,1,nil,tp)");
    expect(script).toContain("Duel.GetControl(tc,tp)");
    expect(script).toContain("and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-atk)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ashenedCode),
      { code: ownedTargetCode, name: "Ashened Owned Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: opponentFaceupCode, name: "Ashened ATK Drain Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 66848311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ashenedCode, ownedTargetCode] }, 1: { main: [opponentFaceupCode] } });
    startDuel(session);

    const ashened = requireCard(session, ashenedCode);
    const ownedTarget = requireCard(session, ownedTargetCode);
    const opponentFaceup = requireCard(session, opponentFaceupCode);
    moveDuelCard(session.state, ashened.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ownedTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    ownedTarget.owner = 0;
    ownedTarget.faceUp = true;
    moveDuelCard(session.state, opponentFaceup.uid, "monsterZone", 1).position = "faceUpAttack";
    opponentFaceup.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ashenedCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const controlAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ashened.uid);
    expect(controlAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, controlAction!);

    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1069572978, returned: true },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownedTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ashened.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentFaceup.uid)!, restoredOpen.session.state)).toBe(400);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === opponentFaceup.uid && effect.code === 100)).toEqual([
      expect.objectContaining({ code: 100, sourceUid: opponentFaceup.uid, reset: { flags: 1107169792 }, value: -1800 }),
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "controlChanged")).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: ownedTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ashened.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
