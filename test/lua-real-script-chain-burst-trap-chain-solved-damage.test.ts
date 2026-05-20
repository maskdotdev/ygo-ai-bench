import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const chainBurstCode = "48276469";
const chainTrapCode = "482764690";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChainBurstScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chainBurstCode}.lua`));
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasChainBurstScript)("Lua real script Chain Burst trap chain-solved damage", () => {
  it("restores aux.chainreg EVENT_CHAINING flag into Trap activation damage on chain solved", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chainBurstCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e2:SetOperation(aux.chainreg)");
    expect(script).toContain("e3:SetCode(EVENT_CHAIN_SOLVED)");
    expect(script).toContain("re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsTrapEffect() and e:GetHandler():GetFlagEffect(1)>0");
    expect(script).toContain("Duel.Damage(rp,1000,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === chainBurstCode),
      { code: chainTrapCode, name: "Chain Burst Fixture Trap", kind: "trap", typeFlags: typeTrap },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 48276469, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chainBurstCode, chainTrapCode] }, 1: { main: [] } });
    startDuel(session);

    const chainBurst = requireCard(session, chainBurstCode);
    const chainTrap = requireCard(session, chainTrapCode);
    const burst = moveDuelCard(session.state, chainBurst.uid, "spellTrapZone", 0);
    burst.faceUp = true;
    burst.position = "faceUpAttack";
    const trap = moveDuelCard(session.state, chainTrap.uid, "spellTrapZone", 0);
    trap.faceUp = false;
    trap.position = "faceDown";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${chainTrapCode}.lua`) return chainableTrapScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chainBurstCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const trapActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === chainTrap.uid);
    expect(trapActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, trapActivation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.host.messages).toContain("chain burst trap resolved");
    expect(restoredOpen.session.state.players[0]!.lifePoints).toBe(7000);
    expect(restoredOpen.session.state.players[1]!.lifePoints).toBe(8000);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["chaining", "chainSolved", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "chaining",
        eventCode: 1027,
        eventPlayer: 0,
        eventCardUid: chainTrap.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 1,
        },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 4,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 4,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: chainBurst.uid,
        eventReasonEffectId: 4,
      },
    ]);
  });
});

function chainableTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("chain burst trap resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
