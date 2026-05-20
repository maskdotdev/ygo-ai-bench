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
const hasSalesBanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c64964750.lua"));

describe.skipIf(!hasUpstreamScripts || !hasSalesBanScript)("Lua real script Sales Ban announce activation lock", () => {
  it("restores its announced same-original-code activation locks for both players", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const salesBanCode = "64964750";
    const declaredCode = "1000000";
    const allowedCode = "1000001";
    const salesBanScript = workspace.readScript(`c${salesBanCode}.lua`);
    expect(salesBanScript).toContain("Duel.AnnounceCard(tp)");
    expect(salesBanScript).toContain("return re:GetHandler():IsOriginalCodeRule(e:GetLabel())");
    expect(salesBanScript).toContain("e1:SetTargetRange(0,1)");
    expect(salesBanScript).toContain("e2:SetTargetRange(1,0)");
    const cards: DuelCardData[] = [
      { code: salesBanCode, name: "Sales Ban", kind: "spell", typeFlags: 0x2 },
      { code: declaredCode, name: "Sales Ban Declared Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: allowedCode, name: "Sales Ban Allowed Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 649, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [salesBanCode, declaredCode, allowedCode] },
      1: { main: [declaredCode, allowedCode] },
    });
    startDuel(session);

    const salesBan = requireCard(session, salesBanCode);
    const p0Declared = requireCard(session, declaredCode, 0);
    const p0Allowed = requireCard(session, allowedCode, 0);
    const p1Declared = requireCard(session, declaredCode, 1);
    const p1Allowed = requireCard(session, allowedCode, 1);
    moveDuelCard(session.state, salesBan.uid, "hand", 0);
    moveDuelCard(session.state, p0Declared.uid, "hand", 0);
    moveDuelCard(session.state, p0Allowed.uid, "hand", 0);
    moveDuelCard(session.state, p1Declared.uid, "hand", 1);
    moveDuelCard(session.state, p1Allowed.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${declaredCode}.lua`) return responderScript("sales ban declared responder resolved");
        if (name === `c${allowedCode}.lua`) return responderScript("sales ban allowed responder resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(salesBanCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(declaredCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === salesBan.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toContainEqual(expect.objectContaining({
      api: "AnnounceCard",
      player: 0,
      options: [Number(declaredCode), Number(allowedCode), Number(salesBanCode)],
      returned: Number(declaredCode),
    }));
    expect(restored.session.state.cards.find((card) => card.uid === salesBan.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === salesBan.uid && effect.code === 6)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "continuous",
        targetRange: [0, 1],
        luaValueDescriptor: "cannot-activate:same-code",
        label: Number(declaredCode),
        reset: { flags: 0x40000200 },
      }),
      expect.objectContaining({
        event: "continuous",
        targetRange: [1, 0],
        luaValueDescriptor: "cannot-activate:same-code",
        label: Number(declaredCode),
        reset: { flags: 0 },
      }),
    ]));

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);

    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.turnPlayer = 0;
    restoredLock.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === p0Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === p0Allowed.uid)).toBe(true);

    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === p1Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === p1Allowed.uid)).toBe(true);
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
