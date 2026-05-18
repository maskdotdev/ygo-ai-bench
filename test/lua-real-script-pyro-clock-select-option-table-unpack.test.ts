import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const pyroClockCode = "1082946";
const hasPyroClockScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pyroClockCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasPyroClockScript)("Lua real script Pyro Clock SelectOption table.unpack", () => {
  it("restores table-unpacked SelectOption into the selected turn-count effect operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const turnEffectCarrierCode = "1082947";
    const responderCode = "1082948";
    const script = workspace.readScript(`c${pyroClockCode}.lua`);
    expect(script).toContain("local op=Duel.SelectOption(tp,table.unpack(seld))+1");
    expect(script).toContain("local eff={tc:GetCardEffect(id)}");
    const cards: DuelCardData[] = [
      { code: pyroClockCode, name: "Pyro Clock of Destiny", kind: "trap", typeFlags: typeTrap },
      { code: turnEffectCarrierCode, name: "Pyro Clock Turn Effect Carrier", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Pyro Clock Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1082, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pyroClockCode, turnEffectCarrierCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pyroClock = session.state.cards.find((card) => card.code === pyroClockCode);
    const carrier = session.state.cards.find((card) => card.code === turnEffectCarrierCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pyroClock).toBeDefined();
    expect(carrier).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pyroClock!.uid, "spellTrapZone", 0);
    pyroClock!.faceUp = false;
    pyroClock!.sequence = 1;
    moveDuelCard(session.state, carrier!.uid, "monsterZone", 0);
    carrier!.sequence = 0;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${pyroClockCode}.lua`) {
          const script = workspace.readScript(name);
          if (!script) return script;
          return pyroClockHarnessScript(script);
        }
        if (name === `c${turnEffectCarrierCode}.lua`) return turnEffectCarrierScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pyroClockCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(turnEffectCarrierCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.filter((effect) => effect.sourceUid === carrier!.uid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 801 }),
        expect.objectContaining({ description: 802 }),
      ]),
    );

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === pyroClock!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 1,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-1082946-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === carrier!.uid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 801 }),
        expect.objectContaining({ description: 802 }),
      ]),
    );
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectOption", player: 0, options: [0, 1], descriptions: [801, 802], returned: 0 }),
    ]));
    expect(restored.host.messages).toContain("pyro clock selected first turn effect");
    expect(restored.host.messages).not.toContain("pyro clock selected second turn effect");
    expect(restored.host.messages).not.toContain("pyro clock responder resolved");
  });
});

function turnEffectCarrierScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(1082946)
      e1:SetRange(LOCATION_MZONE)
      e1:SetDescription(801)
      e1:SetOperation(function(e,tp) Debug.Message("pyro clock selected first turn effect") end)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_FIELD)
      e2:SetCode(1082946)
      e2:SetRange(LOCATION_MZONE)
      e2:SetDescription(802)
      e2:SetOperation(function(e,tp) Debug.Message("pyro clock selected second turn effect") end)
      c:RegisterEffect(e2)
    end
  `;
}

function pyroClockHarnessScript(officialScript: string): string {
  return `${officialScript}
    local original_initial_effect= s.initial_effect
    function s.initial_effect(c)
      original_initial_effect(c)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_IGNITION)
      e2:SetRange(LOCATION_SZONE)
      e2:SetOperation(s.activate)
      c:RegisterEffect(e2)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("pyro clock responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
