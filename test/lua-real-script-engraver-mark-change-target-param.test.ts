import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const engraverCode = "50078320";
const announceSpellCode = "90078320";
const hasEngraverScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${engraverCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasEngraverScript)("Lua real script Engraver ChangeTargetParam", () => {
  it("restores announce-chain response into ChangeTargetParam before the original operation reads it", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${engraverCode}.lua`);
    expect(script).toContain("Duel.GetOperationInfo(ev,CATEGORY_ANNOUNCE)");
    expect(script).toContain("Duel.AnnounceCard(tp,cv)");
    expect(script).toContain("Duel.ChangeTargetParam(ev,ac)");

    const cards: DuelCardData[] = [
      { code: engraverCode, name: "Engraver of the Mark", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: announceSpellCode, name: "Engraver Announce Param Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${announceSpellCode}.lua`) return announceParamSpellScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 50078320, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [engraverCode] }, 1: { main: [announceSpellCode] } });
    startDuel(session);

    const engraver = requireCard(session, engraverCode);
    const spell = requireCard(session, announceSpellCode);
    moveDuelCard(session.state, engraver.uid, "hand", 0);
    moveDuelCard(session.state, spell.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(engraverCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(announceSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    const starter = getLuaRestoreLegalActions(restoredInitial, 1).find((action) => action.type === "activateEffect" && action.uid === spell.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, starter!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    expect(restoredResponse.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: spell.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        targetParam: 90078320,
        operationInfos: [{ category: 0x20000000, targetUids: [], count: 0, player: 1, parameter: 7 }],
      },
    ]);
    const response = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === engraver.uid);
    expect(response, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    expect(response?.windowKind).toBe("chainResponse");
    applyRestoredActionAndAssert(restoredResponse, response!);
    expect(restoredResponse.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(engraverCode), Number(announceSpellCode)], descriptions: [Number(engraverCode), Number(announceSpellCode)], returned: Number(engraverCode) },
    ]);
    expect(restoredResponse.session.state.chain).toEqual([]);
    expect(restoredResponse.host.messages).toContain(`engraver changed target param ${engraverCode}`);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === engraver.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: engraver.uid,
      reasonEffectId: 1,
    });
    expect(restoredResponse.host.messages).not.toContain(`engraver changed target param ${announceSpellCode}`);
    expect(restoredResponse.host.messages).not.toContain("attempt to call a nil value");
  });
});

function announceParamSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_ANNOUNCE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return true end
      Duel.SetTargetParam(id)
      Duel.SetOperationInfo(0,CATEGORY_ANNOUNCE,nil,0,tp,ANNOUNCE_CARD)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local ac=Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)
      Debug.Message("engraver changed target param " .. tostring(ac))
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
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
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
