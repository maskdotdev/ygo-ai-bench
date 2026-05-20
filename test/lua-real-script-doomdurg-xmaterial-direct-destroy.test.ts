import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const doomdurgCode = "68831625";
const hasDoomdurgScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${doomdurgCode}.lua`));
const xyzHolderCode = "688316250";
const destroyTargetCode = "688316251";
const typeMonster = 0x1;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasDoomdurgScript)("Lua real script DoomZ Xyz material direct destroy", () => {
  it("restores Xyz-material quick effect activation into destroy, ATK gain, and direct attack grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${doomdurgCode}.lua`);
    expect(script).toContain("e7:SetType(EFFECT_TYPE_XMATERIAL+EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("local c=e:GetHandler() return c:IsAttribute(ATTRIBUTE_WIND) and c:IsRace(RACE_MACHINE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,dg,1,tp,0)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,nil,1,tp,atk)");
    expect(script).toContain("e2:SetCode(EFFECT_DIRECT_ATTACK)");

    const cards: DuelCardData[] = [
      { code: doomdurgCode, name: "DoomZ Command D.O.O.M.D.U.R.G.", kind: "spell", typeFlags: 0x2 | 0x40000 },
      { code: xyzHolderCode, name: "DoomZ WIND Machine Xyz Holder", kind: "monster", typeFlags: typeMonster | typeXyz, race: raceMachine, attribute: attributeWind, level: 4, attack: 1800, defense: 1000 },
      { code: destroyTargetCode, name: "DoomZ Face-Up Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 68831625, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [doomdurgCode, destroyTargetCode], extra: [xyzHolderCode] }, 1: { main: [] } });
    startDuel(session);

    const doomdurg = requireCard(session, doomdurgCode);
    const xyzHolder = requireCard(session, xyzHolderCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    moveDuelCard(session.state, doomdurg.uid, "overlay", 0);
    moveDuelCard(session.state, xyzHolder.uid, "monsterZone", 0).position = "faceUpAttack";
    xyzHolder.faceUp = true;
    xyzHolder.overlayUids.push(doomdurg.uid);
    moveDuelCard(session.state, destroyTarget.uid, "monsterZone", 0).position = "faceUpAttack";
    destroyTarget.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doomdurgCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === xyzHolder.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: xyzHolder.uid,
    });
    const restoredXyzHolder = restoredOpen.session.state.cards.find((card) => card.uid === xyzHolder.uid);
    expect(restoredXyzHolder).toBeDefined();
    expect(currentAttack(restoredXyzHolder, restoredOpen.session.state)).toBe(2200);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === xyzHolder.uid && effect.code === 100)).toHaveLength(1);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === xyzHolder.uid && effect.code === 74)).toHaveLength(1);

    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) => action.type === "declareAttack" && action.attackerUid === xyzHolder.uid && action.directAttack === true)).toBe(true);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "destroyed").map((event) => event.eventCardUid)).toEqual([destroyTarget.uid]);
  });
});

function requireCard(session: DuelSession, code: string) {
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
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}
