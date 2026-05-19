import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Caligo Claw Crow Special Summon procedure", () => {
  it("restores its face-up DARK monster and open MZONE hand Special Summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const caligoCode = "67692580";
    const darkTargetCode = "67692581";
    const lightDecoyCode = "67692582";
    const blockerCodes = ["67692583", "67692584", "67692585", "67692586"];
    const script = workspace.readScript(`official/c${caligoCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_DARK)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === caligoCode),
      monster(darkTargetCode, "Caligo DARK Procedure Target", attributeDark),
      monster(lightDecoyCode, "Caligo LIGHT Procedure Decoy", attributeLight),
      ...blockerCodes.map((code, index) => monster(code, `Caligo Zone Blocker ${index + 1}`, attributeLight)),
    ];
    const reader = createCardReader(cards);

    const wrongAttribute = createRestoredCaligoWindow({
      caligoCode,
      darkTargetCode,
      lightDecoyCode,
      blockerCodes,
      reader,
      workspace,
      fieldCase: "wrongAttribute",
    });
    expectCleanRestore(wrongAttribute);
    expectRestoredActionSurfaces(wrongAttribute, 0);
    expect(getLuaRestoreLegalActions(wrongAttribute, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const faceDownDark = createRestoredCaligoWindow({
      caligoCode,
      darkTargetCode,
      lightDecoyCode,
      blockerCodes,
      reader,
      workspace,
      fieldCase: "faceDownDark",
    });
    expectCleanRestore(faceDownDark);
    expectRestoredActionSurfaces(faceDownDark, 0);
    expect(getLuaRestoreLegalActions(faceDownDark, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const fullMonsterZone = createRestoredCaligoWindow({
      caligoCode,
      darkTargetCode,
      lightDecoyCode,
      blockerCodes,
      reader,
      workspace,
      fieldCase: "fullMonsterZone",
    });
    expectCleanRestore(fullMonsterZone);
    expectRestoredActionSurfaces(fullMonsterZone, 0);
    expect(getLuaRestoreLegalActions(fullMonsterZone, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredCaligoWindow({
      caligoCode,
      darkTargetCode,
      lightDecoyCode,
      blockerCodes,
      reader,
      workspace,
      fieldCase: "valid",
    });
    expectCleanRestore(restored);
    expectRestoredActionSurfaces(restored, 0);

    const caligo = restored.session.state.cards.find((card) => card.code === caligoCode);
    const darkTarget = restored.session.state.cards.find((card) => card.code === darkTargetCode);
    const lightDecoy = restored.session.state.cards.find((card) => card.code === lightDecoyCode);
    expect(caligo).toBeDefined();
    expect(darkTarget).toBeDefined();
    expect(lightDecoy).toBeDefined();
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === caligo!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(procedure).toMatchObject({ windowKind: "open", label: "Special Summon Caligo Claw Crow" });

    const result = applyLuaRestoreResponse(restored, procedure as DuelAction);
    expect(result.ok, result.error).toBe(true);
    const waitingFor = restored.session.state.waitingFor;
    if (waitingFor !== undefined) {
      expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
      expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
      expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    }

    expect(restored.session.state.cards.find((card) => card.uid === caligo!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === darkTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      data: { attribute: attributeDark },
    });
    expect(restored.session.state.cards.find((card) => card.uid === lightDecoy!.uid)).toMatchObject({
      location: "deck",
      data: { attribute: attributeLight },
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: caligo!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
  });
});

type CaligoFieldCase = "valid" | "wrongAttribute" | "faceDownDark" | "fullMonsterZone";

function createRestoredCaligoWindow({
  caligoCode,
  darkTargetCode,
  lightDecoyCode,
  blockerCodes,
  reader,
  workspace,
  fieldCase,
}: {
  caligoCode: string;
  darkTargetCode: string;
  lightDecoyCode: string;
  blockerCodes: string[];
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  fieldCase: CaligoFieldCase;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 6769 + fieldCase.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [caligoCode, darkTargetCode, lightDecoyCode, ...blockerCodes] }, 1: { main: [] } });
  startDuel(session);

  const caligo = session.state.cards.find((card) => card.code === caligoCode);
  const darkTarget = session.state.cards.find((card) => card.code === darkTargetCode);
  const lightDecoy = session.state.cards.find((card) => card.code === lightDecoyCode);
  expect(caligo).toBeDefined();
  expect(darkTarget).toBeDefined();
  expect(lightDecoy).toBeDefined();
  moveDuelCard(session.state, caligo!.uid, "hand", 0);
  if (fieldCase === "wrongAttribute") {
    moveDuelCard(session.state, lightDecoy!.uid, "monsterZone", 0);
    lightDecoy!.faceUp = true;
    lightDecoy!.position = "faceUpAttack";
  } else {
    moveDuelCard(session.state, darkTarget!.uid, "monsterZone", 0);
    darkTarget!.faceUp = fieldCase !== "faceDownDark";
    darkTarget!.position = fieldCase === "faceDownDark" ? "faceDownDefense" : "faceUpAttack";
  }
  if (fieldCase === "fullMonsterZone") {
    for (const blockerCode of blockerCodes) {
      const blocker = session.state.cards.find((card) => card.code === blockerCode);
      expect(blocker).toBeDefined();
      moveDuelCard(session.state, blocker!.uid, "monsterZone", 0);
      blocker!.faceUp = true;
      blocker!.position = "faceUpAttack";
    }
  }
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(caligoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function monster(code: string, name: string, attribute: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster, attribute, level: 4, attack: 1000, defense: 1000 };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredActionSurfaces(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
}
