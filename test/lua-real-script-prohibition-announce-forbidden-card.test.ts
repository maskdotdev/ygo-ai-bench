import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasProhibitionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c43711255.lua"));

describe.skipIf(!hasUpstreamScripts || !hasProhibitionScript)("Lua real script Prohibition announce forbidden card", () => {
  it("restores its S/T-zone same-original-code forbidden-card lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const prohibitionCode = "43711255";
    const declaredCode = "1000000";
    const allowedCode = "1000001";
    const prohibitionScript = workspace.readScript(`c${prohibitionCode}.lua`);
    expect(prohibitionScript).toContain("Duel.AnnounceCard(tp)");
    expect(prohibitionScript).toContain("e2:SetCode(EFFECT_FORBIDDEN)");
    expect(prohibitionScript).toContain("e2:SetLabelObject(e1)");
    expect(prohibitionScript).toContain("c:IsOriginalCodeRule(e:GetLabelObject():GetLabel())");
    const cards: DuelCardData[] = [
      { code: prohibitionCode, name: "Prohibition", kind: "spell", typeFlags: 0x20002 },
      { code: declaredCode, name: "Prohibition Declared Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: allowedCode, name: "Prohibition Allowed Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 437, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [prohibitionCode, declaredCode, allowedCode] },
      1: { main: [declaredCode, allowedCode] },
    });
    startDuel(session);

    const prohibition = requireCard(session, prohibitionCode);
    const p0Declared = requireCard(session, declaredCode, 0);
    const p0Allowed = requireCard(session, allowedCode, 0);
    const p1Declared = requireCard(session, declaredCode, 1);
    const p1Allowed = requireCard(session, allowedCode, 1);
    moveDuelCard(session.state, prohibition.uid, "hand", 0);
    moveDuelCard(session.state, p0Declared.uid, "hand", 0);
    moveDuelCard(session.state, p0Allowed.uid, "hand", 0);
    moveDuelCard(session.state, p1Declared.uid, "hand", 1);
    moveDuelCard(session.state, p1Allowed.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${declaredCode}.lua`) return responderScript("prohibition declared responder resolved");
        if (name === `c${allowedCode}.lua`) return responderScript("prohibition allowed responder resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(prohibitionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(declaredCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === prohibition.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toContainEqual(expect.objectContaining({
      api: "AnnounceCard",
      player: 0,
      options: [Number(declaredCode), Number(allowedCode), Number(prohibitionCode)],
      returned: Number(declaredCode),
    }));
    expect(restored.session.state.cards.find((card) => card.uid === prohibition.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === prohibition.uid && effect.code === 292)).toMatchObject({
      event: "continuous",
      range: ["spellTrapZone"],
      targetRange: [0x7f, 0x7f],
      luaTargetDescriptor: "target:same-code-label-object-label",
      label: Number(declaredCode),
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);

    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.turnPlayer = 0;
    restoredLock.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "normalSummon" && action.uid === p0Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "setMonster" && action.uid === p0Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === p0Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => actionHasUid(action, p0Allowed.uid))).toBe(true);

    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "normalSummon" && action.uid === p1Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "setMonster" && action.uid === p1Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === p1Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => actionHasUid(action, p1Allowed.uid))).toBe(true);
    expect(restoredLock.host.messages).not.toContain("prohibition declared responder resolved");
  });
});

function responderScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string, controller = 0) {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === controller);
  expect(card).toBeDefined();
  return card!;
}

function actionHasUid(action: DuelAction, uid: string): boolean {
  return "uid" in action && action.uid === uid;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
