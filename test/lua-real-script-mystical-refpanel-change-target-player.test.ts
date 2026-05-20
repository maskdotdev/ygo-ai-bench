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
const refpanelCode = "35563539";
const starterCode = "355635390";
const hasRefpanelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${refpanelCode}.lua`));
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasRefpanelScript)("Lua real script Mystical Refpanel ChangeTargetPlayer", () => {
  it("restores player-target Spell response into ChangeTargetPlayer before the original damage resolves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${refpanelCode}.lua`);
    expect(script).toContain("re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsSpellEffect() and re:IsHasProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("local p=Duel.GetChainInfo(ev,CHAININFO_TARGET_PLAYER)");
    expect(script).toContain("Duel.ChangeTargetPlayer(ev,1-p)");

    const cards: DuelCardData[] = [
      { code: refpanelCode, name: "Mystical Refpanel", kind: "trap", typeFlags: typeTrap },
      { code: starterCode, name: "Refpanel Player Target Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return playerTargetSpellScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 35563539, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [refpanelCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const refpanel = requireCard(session, refpanelCode);
    const starter = requireCard(session, starterCode);
    moveDuelCard(session.state, refpanel.uid, "spellTrapZone", 0);
    refpanel.faceUp = false;
    refpanel.position = "faceDown";
    refpanel.turnId = 0;
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(refpanelCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    const spell = getLuaRestoreLegalActions(restoredInitial, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(spell, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    const spellResponse = applyLuaRestoreResponse(restoredInitial, spell!);
    expect(spellResponse.ok, spellResponse.error).toBe(true);

    const restoredSpell = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredSpell);
    expectRestoredLegalActions(restoredSpell, 0);
    expect(restoredSpell.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-2-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        targetPlayer: 1,
        targetParam: 700,
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 700 }],
      },
    ]);
    const trap = getLuaRestoreLegalActions(restoredSpell, 0).find((action) => action.type === "activateEffect" && action.uid === refpanel.uid);
    expect(trap, JSON.stringify(getLuaRestoreLegalActions(restoredSpell, 0), null, 2)).toBeDefined();
    expect(trap?.windowKind).toBe("chainResponse");
    applyRestoredActionAndAssert(restoredSpell, trap!);
    expect(restoredSpell.session.state.chain).toEqual([]);
    expect(restoredSpell.session.state.players[0].lifePoints).toBe(7300);
    expect(restoredSpell.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredSpell.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 700,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: starter.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredSpell.host.messages).not.toContain("attempt to call a nil value");
  });
});

function playerTargetSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return true end
      Duel.SetTargetPlayer(tp)
      Duel.SetTargetParam(700)
      Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,700)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
      Duel.Damage(p,d,REASON_EFFECT)
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
