import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const oreillerCode = "17550376";
const dreamingNemleriaCode = "70155677";
const faceDownExtraCode = "175503760";
const opponentCode = "175503761";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOreillerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${oreillerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const attributeLight = 0x10;
const raceBeast = 0x4000;

describe.skipIf(!hasUpstreamScripts || !hasOreillerScript)("Lua real script Nemleria Oreiller extra pendulum procedure stat", () => {
  it("restores face-up Extra Deck Pendulum summon procedure and quick ATK boost metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${oreillerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const blocked = createRestoredOreillerWindow({ reader, source, workspace, faceUpNemleria: false, oreillerLocation: "hand" });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredOreillerWindow({ reader, source, workspace, faceUpNemleria: true, oreillerLocation: "hand" });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const oreiller = requireCard(restored.session, oreillerCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === oreiller.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 34, event: "summonProcedure", property: 262144, range: ["hand"], sourceUid: oreiller.uid },
      { category: 2097152, code: 1002, event: "quick", property: 16384, range: ["monsterZone"], sourceUid: oreiller.uid },
    ]);
    expect(getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === oreiller.uid)).toMatchObject({
      label: "Special Summon Nemleria Dream Defender - Oreiller",
      windowKind: "open",
    });

    const quickWindow = createRestoredOreillerWindow({ reader, source, workspace, faceUpNemleria: true, oreillerLocation: "monsterZone" });
    expectCleanRestore(quickWindow);
    expectRestoredLegalActions(quickWindow, 0);
    expect(getLuaRestoreLegalActions(quickWindow, 0).find((action) => action.type === "activateEffect" && action.uid === requireCard(quickWindow.session, oreillerCode).uid)).toMatchObject({
      effectId: expect.stringMatching(/^lua-/),
      type: "activateEffect",
    });
  });
});

function createRestoredOreillerWindow({
  reader,
  source,
  workspace,
  faceUpNemleria,
  oreillerLocation,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  faceUpNemleria: boolean;
  oreillerLocation: "hand" | "monsterZone";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 17550376, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [oreillerCode, opponentCode], extra: [dreamingNemleriaCode, faceDownExtraCode] }, 1: { main: [] } });
  startDuel(session);
  const oreiller = requireCard(session, oreillerCode);
  const dreamingNemleria = requireCard(session, dreamingNemleriaCode);
  const faceDownExtra = requireCard(session, faceDownExtraCode);
  const opponent = requireCard(session, opponentCode);
  const movedOreiller = moveDuelCard(session.state, oreiller.uid, oreillerLocation, 0);
  if (oreillerLocation === "monsterZone") {
    movedOreiller.faceUp = true;
    movedOreiller.position = "faceUpAttack";
  }
  moveDuelCard(session.state, dreamingNemleria.uid, "extraDeck", 0).faceUp = faceUpNemleria;
  moveDuelCard(session.state, faceDownExtra.uid, "extraDeck", 0).faceUp = false;
  const movedOpponent = moveDuelCard(session.state, opponent.uid, "monsterZone", 1);
  movedOpponent.faceUp = true;
  movedOpponent.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(oreillerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    monster(oreillerCode, "Nemleria Dream Defender - Oreiller", 10, 2500, 2000, typeMonster | typeEffect),
    monster(dreamingNemleriaCode, "Dreaming Nemleria", 1, 0, 1500, typeMonster | typeEffect | typePendulum),
    monster(faceDownExtraCode, "Oreiller Face-Down Extra Cost", 4, 1000, 1000, typeMonster | typeEffect),
    monster(opponentCode, "Oreiller Opponent Monster", 4, 1000, 1000, typeMonster | typeEffect),
  ];
}

function monster(code: string, name: string, level: number, attack: number, defense: number, typeFlags: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags,
    race: raceBeast,
    attribute: attributeLight,
    level,
    attack,
    defense,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Nemleria Dream Defender - Oreiller");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsType,TYPE_PENDULUM),tp,LOCATION_EXTRA,0,1,nil)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_DREAMING_NEMLERIA),tp,LOCATION_EXTRA,0,1,nil)");
  expect(script).toContain("aux.StatChangeDamageStepCondition()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_EXTRA,0,1,1,nil)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*500)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
