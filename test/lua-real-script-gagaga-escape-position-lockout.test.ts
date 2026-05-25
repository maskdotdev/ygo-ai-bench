import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const escapeCode = "9591819";
const hasEscapeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${escapeCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const setGagaga = 0x54;

describe.skipIf(!hasUpstreamScripts || !hasEscapeScript)("Lua real script Gagaga Escape position lockout", () => {
  it("restores Gagaga Escape and keeps IsCanChangePosition-locked Gagaga monsters unchanged", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const eligibleCode = "9591";
    const attackedCode = "9592";
    const changedCode = "9593";
    const responderCode = "9594";
    const script = workspace.readScript(`c${escapeCode}.lua`);
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("c:IsSetCard(SET_GAGAGA) and c:IsPosition(POS_FACEUP_ATTACK) and c:IsCanChangePosition()");
    expect(script).toContain("Duel.ChangePosition(g,POS_FACEUP_DEFENSE,POS_FACEDOWN_DEFENSE,0,0)");
    const cards: DuelCardData[] = [
      { code: escapeCode, name: "Gagaga Escape", kind: "trap", typeFlags: typeTrap },
      { code: eligibleCode, name: "Gagaga Eligible Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000, setcodes: [setGagaga] },
      { code: attackedCode, name: "Gagaga Attacked Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000, setcodes: [setGagaga] },
      { code: changedCode, name: "Gagaga Changed Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1000, setcodes: [setGagaga] },
      { code: responderCode, name: "Gagaga Escape Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 959, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [escapeCode, eligibleCode, attackedCode, changedCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const escape = session.state.cards.find((card) => card.code === escapeCode);
    const eligible = session.state.cards.find((card) => card.code === eligibleCode);
    const attacked = session.state.cards.find((card) => card.code === attackedCode);
    const changed = session.state.cards.find((card) => card.code === changedCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(escape).toBeDefined();
    expect(eligible).toBeDefined();
    expect(attacked).toBeDefined();
    expect(changed).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, escape!.uid, "graveyard", 0);
    moveDuelCard(session.state, eligible!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacked!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, changed!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.attacksDeclared.push(attacked!.uid);
    session.state.positionsChanged.push(changed!.uid);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(escapeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === escape!.uid);
    expect(activate).toBeDefined();
    const activated = applyAndAssert(session, activate!);
    expect(activated.state.chain).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === escape!.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(session.state.chain[0]?.operationInfos).toEqual([
      expect.objectContaining({
        category: 0x1000,
        targetUids: [eligible!.uid, attacked!.uid, changed!.uid],
        count: 3,
        player: 0,
        parameter: 4,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === eligible!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === attacked!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === changed!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(restored.session.state.positionsChanged).toEqual([changed!.uid, eligible!.uid, attacked!.uid, changed!.uid]);
    expect(restored.session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "positionChanged" }));
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged").map((event) => event.eventCardUid)).toEqual([
      eligible!.uid,
      attacked!.uid,
      changed!.uid,
      eligible!.uid,
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === escape!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: escape!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: escape!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("gagaga escape responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("gagaga escape responder resolved") end)
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
