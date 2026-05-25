import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const playmakerCode = "98229575";
const uaAllyCode = "982295750";
const offSetCode = "982295751";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPlaymakerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${playmakerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeEarth = 0x10;
const raceWarrior = 0x1;
const setUa = 0xb2;

describe.skipIf(!hasUpstreamScripts || !hasPlaymakerScript)("Lua real script U.A. Playmaker return procedure", () => {
  it("restores U.A. return-to-hand Special Summon procedure and attack-announce trigger metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${playmakerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const blocked = createRestoredPlaymakerWindow({ reader, source, workspace, fieldCase: "offSet" });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredPlaymakerWindow({ reader, source, workspace, fieldCase: "valid" });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const playmaker = requireCard(restored.session, playmakerCode);
    const uaAlly = requireCard(restored.session, uaAllyCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === playmaker.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 34, event: "summonProcedure", property: 262144, range: ["hand"], sourceUid: playmaker.uid, triggerEvent: undefined },
      { category: 2097152, code: 1130, event: "trigger", property: undefined, range: ["monsterZone"], sourceUid: playmaker.uid, triggerEvent: "attackDeclared" },
    ]);
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === playmaker.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toMatchObject({
      label: "Special Summon U.A. Playmaker",
      windowKind: "open",
    });
    const result = applyLuaRestoreResponse(restored, procedure as DuelAction);
    expect(result.ok, result.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === playmaker.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "monsterZone",
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === uaAlly.uid)).toMatchObject({
      controller: 0,
      location: "hand",
    });
  });
});

function createRestoredPlaymakerWindow({
  reader,
  source,
  workspace,
  fieldCase,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  fieldCase: "valid" | "offSet";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 98229575, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [playmakerCode, uaAllyCode, offSetCode] }, 1: { main: [] } });
  startDuel(session);
  const playmaker = requireCard(session, playmakerCode);
  const fieldMonster = requireCard(session, fieldCase === "valid" ? uaAllyCode : offSetCode);
  moveDuelCard(session.state, playmaker.uid, "hand", 0);
  const movedFieldMonster = moveDuelCard(session.state, fieldMonster.uid, "monsterZone", 0);
  movedFieldMonster.faceUp = true;
  movedFieldMonster.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(playmakerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    ua(playmakerCode, "U.A. Playmaker", 2600, [setUa]),
    ua(uaAllyCode, "U.A. Playmaker Field Ally", 1500, [setUa]),
    ua(offSetCode, "Playmaker Off-Set Field Monster", 1500, [0x123]),
  ];
}

function ua(code: string, name: string, attack: number, setcodes: number[]): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceWarrior,
    attribute: attributeEarth,
    setcodes,
    level: 8,
    attack,
    defense: 2000,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--U.A. Playmaker");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,1,1,nil,0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,1,1,nil,1,tp,HINTMSG_RTOHAND,nil,nil,true)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_COST)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-800)");
  expect(script).toContain("e2:SetValue(800)");
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
