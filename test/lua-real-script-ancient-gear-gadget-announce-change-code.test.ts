import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentCardMatchesCode } from "#duel/card-code-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ancientGearGadgetCode = "18486927";
const greenGadgetCode = "41172955";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ancient Gear Gadget announce name", () => {
  it("restores announced Gadget name as an EFFECT_CHANGE_CODE on the face-up monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${ancientGearGadgetCode}.lua`);
    expect(script).toContain("Duel.SelectOption(tp,70,71,72)");
    expect(script).toContain("Duel.AnnounceCard(tp,table.unpack(s.announce_filter))");
    expect(script).toContain("Duel.SetTargetParam(ac)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ANNOUNCE,nil,0,tp,ANNOUNCE_CARD_FILTER)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e1:SetValue(ac)");

    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [ancientGearGadgetCode, greenGadgetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18486927, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ancientGearGadgetCode, greenGadgetCode] }, 1: { main: [] } });
    startDuel(session);

    const ancientGearGadget = requireCard(session, ancientGearGadgetCode);
    moveDuelCard(session.state, ancientGearGadget.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ancientGearGadgetCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === ancientGearGadget.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(greenGadgetCode)], descriptions: [Number(greenGadgetCode)], returned: Number(greenGadgetCode) },
    ]);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restored.session.state.eventHistory.filter((event) => ["codeChanged"].includes(event.eventName))).toEqual([]);
    const changeCodeEffect = restored.session.state.effects.find((effect) => effect.code === 114 && effect.sourceUid === ancientGearGadget.uid);
    expect(changeCodeEffect).toBeDefined();
    expect(changeCodeEffect?.value).toBe(Number(greenGadgetCode));
    expect(changeCodeEffect?.range).toEqual(["monsterZone"]);
    expect(changeCodeEffect?.targetRange).toBeUndefined();
    const restoredAncientGearGadget = restored.session.state.cards.find((card) => card.uid === ancientGearGadget.uid)!;
    expect(currentCardMatchesCode(restoredAncientGearGadget, restored.session.state, greenGadgetCode)).toBe(true);
    expect(currentCardMatchesCode(restoredAncientGearGadget, restored.session.state, ancientGearGadgetCode)).toBe(false);
    expect(restored.host.messages).not.toContain("unsupported callback");

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
