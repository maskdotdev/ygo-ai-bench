import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
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
const photonHandCode = "15520842";
const galaxyEyesCode = "93717133";
const opponentNonXyzCode = "155208420";
const opponentXyzDecoyCode = "155208421";
const responderCode = "155208422";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const setGalaxy = 0x7b;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Photon Hand Galaxy control", () => {
  it("restores Galaxy-Eyes condition, LP cost, and non-Xyz opponent control target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${photonHandCode}.lua`);
    expect(script).toContain("--Photon Hand");
    expect(script).toContain("e1:SetCost(Cost.PayLP(1000))");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard({SET_PHOTON,SET_GALAXY})");
    expect(script).toContain("aux.FaceupFilter(Card.IsCode,CARD_GALAXYEYES_P_DRAGON)");
    expect(script).toContain("return (ged or (c:IsFaceup() and c:IsType(TYPE_XYZ))) and c:IsControlerCanBeChanged()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,tp,ged)");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 15520842, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [photonHandCode, galaxyEyesCode] },
      1: { main: [opponentNonXyzCode, opponentXyzDecoyCode, responderCode] },
    });
    startDuel(session);

    const photonHand = requireCard(session, photonHandCode);
    const galaxyEyes = requireCard(session, galaxyEyesCode);
    const opponentNonXyz = requireCard(session, opponentNonXyzCode);
    const opponentXyzDecoy = requireCard(session, opponentXyzDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, photonHand.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    moveFaceUpAttack(session, galaxyEyes, 0, 0);
    moveFaceUpAttack(session, opponentNonXyz, 1, 0);
    moveFaceUpAttack(session, opponentXyzDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(photonHandCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === photonHand.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.chain.map((link) => ({
      player: link.player,
      sourceUid: link.sourceUid,
      operationInfos: link.operationInfos,
      targetUids: link.targetUids,
    }))).toEqual([
      {
        player: 0,
        sourceUid: photonHand.uid,
        operationInfos: [{ category: categoryControl, targetUids: [opponentNonXyz.uid], count: 1, player: 0, parameter: 0 }],
        targetUids: [opponentNonXyz.uid],
      },
    ]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === photonHand.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentNonXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: photonHand.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentXyzDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.host.messages).not.toContain("photon hand responder resolved");
    expect(restoredOpen.session.state.eventHistory.some((event) => event.eventName === "lifePointCostPaid" && event.eventPlayer === 0 && event.eventValue === 1000)).toBe(true);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    expect(restoredControl.session.state.cards.find((card) => card.uid === opponentNonXyz.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === photonHandCode),
    { code: galaxyEyesCode, name: "Galaxy-Eyes Photon Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, setcodes: [setGalaxy], level: 8, attack: 3000, defense: 2500 },
    { code: opponentNonXyzCode, name: "Photon Hand Non-Xyz Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: opponentXyzDecoyCode, name: "Photon Hand Xyz Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1400 },
    { code: responderCode, name: "Photon Hand Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("photon hand responder resolved") end)
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
