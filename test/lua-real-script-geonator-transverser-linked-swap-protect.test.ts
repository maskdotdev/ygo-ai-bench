import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const geonatorCode = "52119435";
const ownLinkedCode = "521194351";
const opponentLinkedCode = "521194352";
const openMonsterCode = "521194353";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGeonatorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${geonatorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeEarth = 0x10;
const categoryControl = 0x2000;
const effectIndestructibleEffect = 41;

describe.skipIf(!hasUpstreamScripts || !hasGeonatorScript)("Lua real script Geonator Transverser linked swap protect", () => {
  it("restores cross-controller linked group targeting into SwapControl and linked effect destruction protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${geonatorCode}.lua`);
    expect(script).toContain("--Geonator Transverser");
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),2)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e1:SetValue(aux.indoval)");
    expect(script).toContain("e:GetHandler():GetLinkedGroupCount()==2");
    expect(script).toContain("g:FilterCount(Card.IsAbleToChangeControler,nil)==2");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,2,tp,0)");
    expect(script).toContain("local g=Duel.GetTargetCards(e)");
    expect(script).toContain("Duel.SwapControl(g:GetFirst(),g:GetNext())");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 52119435, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ownLinkedCode, openMonsterCode], extra: [geonatorCode] }, 1: { main: [opponentLinkedCode] } });
    startDuel(session);

    const geonator = requireCard(session, geonatorCode);
    const ownLinked = requireCard(session, ownLinkedCode);
    const opponentLinked = requireCard(session, opponentLinkedCode);
    const openMonster = requireCard(session, openMonsterCode);
    moveFaceUpAttack(session, geonator, 0, 2);
    geonator.summonType = "link";
    geonator.summonPlayer = 0;
    moveFaceUpAttack(session, ownLinked, 0, 1);
    moveFaceUpAttack(session, opponentLinked, 1, 3);
    moveFaceUpAttack(session, openMonster, 0, 4);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(geonatorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const restoredGeonator = requireCard(restoredOpen.session, geonatorCode);
    const restoredOwnLinked = requireCard(restoredOpen.session, ownLinkedCode);
    const restoredOpponentLinked = requireCard(restoredOpen.session, opponentLinkedCode);
    const restoredOpenMonster = requireCard(restoredOpen.session, openMonsterCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === restoredGeonator.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 31, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["monsterZone"], sourceUid: restoredGeonator.uid, targetRange: undefined },
      { code: effectIndestructibleEffect, event: "continuous", id: "lua-2-41", property: 0x100, range: ["monsterZone"], sourceUid: restoredGeonator.uid, targetRange: [4, 4] },
      { code: undefined, event: "ignition", id: "lua-3", property: undefined, range: ["monsterZone"], sourceUid: restoredGeonator.uid, targetRange: undefined },
    ]);
    expect(destroyDuelCard(restoredOpen.session.state, restoredOwnLinked.uid, 0, duelReason.effect | duelReason.destroy, 1)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(destroyDuelCard(restoredOpen.session.state, restoredOpponentLinked.uid, 1, duelReason.effect | duelReason.destroy, 1)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(destroyDuelCard(restoredOpen.session.state, restoredOpenMonster.uid, 0, duelReason.effect | duelReason.destroy, 1)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });

    const restoredSwap = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSwap);
    expectRestoredLegalActions(restoredSwap, 0);
    const action = getLuaRestoreLegalActions(restoredSwap, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === geonator.uid && candidate.effectId === "lua-3");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredSwap, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSwap, action!);
    expect(restoredSwap.session.state.chain).toEqual([]);
    expect(restoredSwap.session.state.cards.find((card) => card.uid === ownLinked.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: geonator.uid,
      reasonEffectId: 3,
    });
    expect(restoredSwap.session.state.cards.find((card) => card.uid === opponentLinked.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: geonator.uid,
      reasonEffectId: 3,
    });
    expect(restoredSwap.session.state.eventHistory.filter((event) => event.eventName === "controlChanged")).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-521194351-0",
          "eventCode": 1120,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "controlChanged",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-52119435-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-521194352-0",
          "eventCode": 1120,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "controlChanged",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 3,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-52119435-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-521194351-0",
          "eventCode": 1120,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "controlChanged",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-52119435-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-521194351-0",
            "p1-deck-521194352-0",
          ],
        },
      ]
    `);

    const restoredAfterSwap = restoreDuelWithLuaScripts(serializeDuel(restoredSwap.session), workspace, reader);
    expectCleanRestore(restoredAfterSwap);
    expectRestoredLegalActions(restoredAfterSwap, 0);
    expect(restoredAfterSwap.session.state.cards.find((card) => card.uid === ownLinked.uid)).toMatchObject({ controller: 1, previousController: 0 });
    expect(restoredAfterSwap.session.state.cards.find((card) => card.uid === opponentLinked.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === geonatorCode).map((card) => ({ ...card, linkMarkers: 0x28 })),
    { code: ownLinkedCode, name: "Geonator Own Linked", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: opponentLinkedCode, name: "Geonator Opponent Linked", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeEarth, level: 4, attack: 1700, defense: 1300 },
    { code: openMonsterCode, name: "Geonator Unlinked Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
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
