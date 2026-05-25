import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttribute } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const amanokujakiCode = "43739056";
const responderCode = "437390560";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x20;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const effectCannotActivate = 6;
const effectChangeAttribute = 127;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Amanokujaki quick control attribute", () => {
  it("restores owner-turn quick control transfer and optional attribute change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${amanokujakiCode}.lua`);
    expect(script).toContain("--Amanokujaki");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ACTIVATE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("Duel.GetTurnPlayer()==e:GetHandler():GetOwner() and Duel.IsMainPhase()");
    expect(script).toContain("Duel.GetControl(c,1-tp)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
    expect(script).toContain("local att=c:AnnounceAnotherAttribute(tp)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_ATTRIBUTE)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 43739056, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [amanokujakiCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const amanokujaki = requireCard(session, amanokujakiCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, amanokujaki, 0, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expect(host.loadCardScript(Number(amanokujakiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === amanokujaki.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: effectCannotActivate, event: "continuous", range: ["monsterZone"] },
      { category: categoryControl, code: 1002, event: "quick", range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === amanokujaki.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      expect.objectContaining({
        player: 0,
        sourceUid: amanokujaki.uid,
        operationInfos: [{ category: categoryControl, targetUids: [amanokujaki.uid], count: 1, player: 0, parameter: 0 }],
      }),
    ]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === amanokujaki.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: amanokujaki.uid,
      reasonEffectId: 2,
    });
    expect(currentAttribute(restoredOpen.session.state.cards.find((card) => card.uid === amanokujaki.uid), restoredOpen.session.state)).toBe(attributeEarth);
    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 699824896, returned: true },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === amanokujaki.uid).some((effect) => effect.code === effectChangeAttribute && effect.value === attributeEarth)).toBe(true);
    expect(restoredOpen.host.messages).not.toContain("amanokujaki responder resolved");

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    expect(restoredControl.session.state.cards.find((card) => card.uid === amanokujaki.uid)).toMatchObject({ controller: 1, previousController: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === amanokujakiCode),
    { code: responderCode, name: "Amanokujaki Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("amanokujaki responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
